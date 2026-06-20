import {
  Injectable,
  Inject,
  Logger,
} from '@nestjs/common';
import { EntityNotFoundError, InvalidOperationError, ForbiddenOperationError } from '../../common/errors/domain.errors';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc } from 'drizzle-orm';
import * as crypto from 'crypto';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  private readonly storeId: string;
  private readonly storePasswd: string;
  private readonly isSandbox: boolean;
  private readonly apiUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly configService: ConfigService,
  ) {
    this.storeId =
      this.configService.get<string>('SSLCOMMERZ_STORE_ID') || 'testbox';
    this.storePasswd =
      this.configService.get<string>('SSLCOMMERZ_STORE_SECRET') || 'testpass';
    this.isSandbox =
      this.configService.get<string>('SSLCOMMERZ_IS_SANDBOX') !== 'false';

    this.apiUrl = this.isSandbox
      ? 'https://sandbox.sslcommerz.com'
      : 'https://securepay.sslcommerz.com';
  }

  /**
   * Validates the SSLCommerz IPN signature.
   * SSLCommerz sends verify_sign and verify_key with every IPN/callback POST.
   * We must recompute the MD5 hash to confirm the request is genuine.
   * Without this check, anyone can POST fake data to mark orders as paid.
   */
  private validateIpnSignature(ipnData: Record<string, string>): boolean {
    const { verify_sign, verify_key, ...rest } = ipnData;

    if (!verify_sign || !verify_key) {
      this.logger.warn('IPN missing verify_sign or verify_key — rejecting');
      return false;
    }

    // Build the hash string: sort keys from verify_key, append store password
    const keys = verify_key.split(',');
    const parts = keys.map((key) => `${key}=${rest[key] ?? ''}`);
    parts.push(`store_passwd=${md5(this.storePasswd)}`);
    const hashString = parts.join('&');

    const computedHash = md5(hashString);
    const isValid = computedHash === verify_sign;

    if (!isValid) {
      this.logger.warn(
        `IPN signature mismatch — possible spoofing attempt. Expected: ${computedHash}, Got: ${verify_sign}`,
      );
    }
    return isValid;
  }

  async initiateCod(userId: string, orderId: string) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    if (!order) throw new EntityNotFoundError('Order not found');
    if (order.userId !== userId) throw new ForbiddenOperationError('Not your order');

    // Allow retry if previous attempt failed; block only on in-progress or settled states
    const nonRetryableStatuses: schema.Order['paymentStatus'][] = ['initiated', 'paid', 'refunded'];
    if (nonRetryableStatuses.includes(order.paymentStatus)) {
      throw new InvalidOperationError(
        'A payment has already been initiated or completed for this order',
      );
    }

    // Update paymentStatus to 'initiated' atomically with payment record creation
    const [payment] = await this.db.transaction(async (tx) => {
      const [pay] = await tx
        .insert(schema.payments)
        .values({
          orderId,
          amount: order.totalAmount,
          method: 'COD',
          status: 'pending',
        })
        .returning();

      await tx
        .update(schema.orders)
        .set({ paymentStatus: 'initiated', updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId));

      return [pay];
    });

    return payment;
  }

  async initiatePayment(
    userId: string,
    orderId: string,
    baseUrl: string,
    requestedMethod = 'sslcommerz',
  ) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    if (!order) throw new EntityNotFoundError('Order not found');
    if (order.userId !== userId) throw new ForbiddenOperationError('Not your order');

    // Hard-block only on settled states — the user cannot retry a paid or refunded order.
    if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') {
      throw new InvalidOperationError('This order has already been paid.');
    }

    // 'initiated' means the user was redirected to the gateway but the callback never fired
    // (common when the user closes the tab, or in SSLCommerz sandbox mode).
    // Auto-recover: cancel the stale pending payment and proceed with the new attempt.
    if (order.paymentStatus === 'initiated') {
      const [stalePayment] = await this.db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, orderId))
        .orderBy(desc(schema.payments.createdAt))
        .limit(1);

      if (stalePayment && stalePayment.status === 'pending') {
        // Gateway never confirmed — safe to void and retry
        await this.db.transaction(async (tx) => {
          await tx
            .update(schema.payments)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(eq(schema.payments.id, stalePayment.id));
          await tx
            .update(schema.orders)
            .set({ paymentStatus: 'unpaid', updatedAt: new Date() })
            .where(eq(schema.orders.id, orderId));
        });
        this.logger.log(
          `Auto-cancelled stale payment ${stalePayment.id} for order ${orderId} — allowing retry.`,
        );
      } else {
        // Payment is in a non-pending state but order still says 'initiated' — data inconsistency
        throw new InvalidOperationError('A payment is already in progress for this order. Please wait or contact support.');
      }
    }

    const validMethods = ['sslcommerz', 'bkash', 'nagad', 'cod'];
    if (!validMethods.includes(requestedMethod)) {
      throw new InvalidOperationError('Invalid payment method');
    }

    if (requestedMethod === 'cod') {
      const payment = await this.initiateCod(userId, orderId);
      return { payment };
    }

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const tranId = `TRN_${Date.now()}_${orderId.substring(0, 5)}`;

    let methodValue = 'SSLCommerz';
    let multiCardName = '';

    if (requestedMethod === 'bkash') {
      methodValue = 'bKash';
      multiCardName = 'bkash';
    } else if (requestedMethod === 'nagad') {
      methodValue = 'Nagad';
      multiCardName = 'nagad';
    }

    // Create a pending payment record and mark order as 'initiated' atomically
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.payments).values({
        orderId,
        amount: order.totalAmount,
        method: methodValue,
        transactionId: tranId,
        status: 'pending',
      });

      await tx
        .update(schema.orders)
        .set({ paymentStatus: 'initiated', updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId));
    });

    const initUrl = `${this.apiUrl}/gwprocess/v4/api.php`;
    const formData = new URLSearchParams({
      store_id: this.storeId,
      store_passwd: this.storePasswd,
      total_amount: order.totalAmount.toString(),
      currency: 'BDT',
      tran_id: tranId,
      success_url: `${baseUrl}/api/v1/payments/sslcommerz/success`,
      fail_url: `${baseUrl}/api/v1/payments/sslcommerz/fail`,
      cancel_url: `${baseUrl}/api/v1/payments/sslcommerz/cancel`,
      cus_name: user.fullName,
      cus_email: user.email,
      cus_add1: 'Dhaka', // Should ideally fetch from order's shipping address
      cus_city: 'Dhaka',
      cus_postcode: '1000',
      cus_country: 'Bangladesh',
      cus_phone: user.phone || '01700000000',
      shipping_method: 'NO',
      product_name: 'Gramoz Order',
      product_category: 'E-Commerce',
      product_profile: 'general',
      // value_a is passed back verbatim in all callbacks — used as a fallback
      // to identify the order when tran_id is absent (e.g. on some cancel flows)
      value_a: orderId,
    });

    if (multiCardName) {
      formData.append('multi_card_name', multiCardName);
    }

    try {
      const response = await fetch(initUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const data = await response.json();

      if (data.status === 'SUCCESS') {
        return { gatewayUrl: data.GatewayPageURL };
      } else {
        this.logger.error('SSLCommerz Init Error:', data);
        throw new InvalidOperationError('Payment gateway initialization failed');
      }
    } catch (error) {
      this.logger.error('SSLCommerz Fetch Error:', error);
      throw new InvalidOperationError('Could not connect to payment gateway');
    }
  }

  async verifyPayment(ipnData: any) {
    // Skip signature validation in sandbox mode to ease testing
    if (!this.isSandbox) {
      const isValid = this.validateIpnSignature(ipnData);
      if (!isValid) {
        this.logger.error(
          'IPN signature validation failed — rejecting request',
        );
        return { success: false, message: 'Invalid IPN signature' };
      }
    }

    const { val_id, tran_id, status } = ipnData;

    if (!val_id || status !== 'VALID') {
      return this.handleFailedPayment(tran_id, ipnData);
    }

    // Verify using Validation API
    const validationUrl = `${this.apiUrl}/validator/api/validationserverAPI.php?val_id=${val_id}&store_id=${this.storeId}&store_passwd=${this.storePasswd}&v=1&format=json`;

    try {
      const response = await fetch(validationUrl);
      const data = await response.json();

      if (data.status === 'VALID' || data.status === 'VALIDATED') {
        return this.handleSuccessfulPayment(tran_id, data);
      } else {
        return this.handleFailedPayment(tran_id, data);
      }
    } catch (error) {
      this.logger.error('SSLCommerz Verification Error:', error);
      throw new InvalidOperationError('Payment verification failed');
    }
  }

  private async handleSuccessfulPayment(tranId: string, validationData: any) {
    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.transactionId, tranId));

    if (!payment) throw new EntityNotFoundError('Payment record not found');

    // Idempotency guard: if this webhook has already been processed, silently
    // return. This prevents replay attacks from re-triggering order updates.
    if (payment.status === 'completed') {
      this.logger.warn(
        `Duplicate IPN received for already-completed transaction ${tranId} — ignoring.`,
      );
      return {
        success: true,
        message: 'Payment already processed (duplicate IPN ignored)',
      };
    }

    // Run in transaction to update both payment and order status atomically
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.payments)
        .set({
          status: 'completed',
          gatewayResponse: validationData,
          updatedAt: new Date(),
        })
        .where(eq(schema.payments.id, payment.id));

      await tx
        .update(schema.orders)
        .set({
          status: 'processing',
          paymentStatus: 'paid',
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, payment.orderId));
    });

    return {
      success: true,
      message: 'Payment verified and order is now processing',
    };
  }

  private async handleFailedPayment(tranId: string, ipnData: any) {
    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.transactionId, tranId));

    if (!payment)
      return { success: false, message: 'Payment record not found' };

    // Idempotency guard: don't overwrite a terminal state
    if (payment.status === 'completed' || payment.status === 'failed') {
      this.logger.warn(
        `Duplicate IPN for transaction ${tranId} with status '${payment.status}' — ignoring.`,
      );
      return { success: false, message: 'Payment already in terminal state (duplicate IPN ignored)' };
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.payments)
        .set({
          status: 'failed',
          gatewayResponse: ipnData,
          updatedAt: new Date(),
        })
        .where(eq(schema.payments.id, payment.id));

      // Reset order payment status to 'unpaid' so the user can retry payment
      await tx
        .update(schema.orders)
        .set({ paymentStatus: 'unpaid', updatedAt: new Date() })
        .where(eq(schema.orders.id, payment.orderId));
    });

    return { success: false, message: 'Payment failed or cancelled' };
  }

  /**
   * Handles SSLCommerz cancel callbacks where tran_id may be absent.
   * Finds the pending payment record and resets the order back to 'unpaid'
   * so the user can select a different payment method and retry.
   */
  async handleCancelCallback(body: any): Promise<void> {
    const tranId: string | undefined = body?.tran_id;

    if (tranId) {
      // Normal path — tran_id present, reuse existing failed-payment logic
      await this.handleFailedPayment(tranId, body);
      return;
    }

    // Fallback: SSLCommerz sometimes omits tran_id on cancel.
    // We embed orderId as value_a during initiation so we can recover here.
    const orderId: string | undefined = body?.value_a;
    if (!orderId) {
      this.logger.warn(
        'Cancel callback received without tran_id or value_a — cannot reset payment state.',
      );
      return;
    }

    // Mark the most recent pending payment as failed and reset order to 'unpaid'
    const [pendingPayment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId));

    if (!pendingPayment) {
      this.logger.warn(`Cancel fallback: no payment found for orderId ${orderId}`);
      return;
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.payments)
        .set({ status: 'failed', gatewayResponse: body, updatedAt: new Date() })
        .where(eq(schema.payments.id, pendingPayment.id));

      await tx
        .update(schema.orders)
        .set({ paymentStatus: 'unpaid', updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId));
    });

    this.logger.log(`Cancel fallback: reset order ${orderId} to 'unpaid' via value_a.`);
  }
}

/** Node crypto-based MD5 — no external dependency needed */
function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

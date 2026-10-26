import { Injectable, Logger } from '@nestjs/common';
import {
  EntityNotFoundError,
  InvalidOperationError,
  ForbiddenOperationError,
} from '../../common/errors/domain.errors';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PaymentsStore } from './payments.store';

export interface SSLCommerzRefundInitiationRaw {
  APIConnect?: string;
  status?: string;
  refund_ref_id?: string;
  bank_tran_id?: string;
  trans_id?: string;
  errorReason?: string;
  [key: string]: any;
}

export interface SSLCommerzRefundInquiryRaw {
  APIConnect?: string;
  status?: string;
  refund_ref_id?: string;
  bank_tran_id?: string;
  tran_id?: string;
  initiated_on?: string;
  refunded_on?: string;
  errorReason?: string;
  [key: string]: any;
}

export interface RefundInitiationResult {
  success: boolean;
  status: 'initiated' | 'processing' | 'failed';
  refundRefId?: string;
  bankTranId?: string;
  errorReason?: string;
  rawResponse?: any;
}

export interface RefundInquiryResult {
  success: boolean;
  status:
    | 'refunded'
    | 'processing'
    | 'cancelled'
    | 'failed_auth'
    | 'invalid_identity'
    | 'unknown_status'
    | 'transport_error';
  refundRefId: string;
  bankTranId?: string;
  tranId?: string;
  initiatedOn?: string;
  refundedOn?: string;
  errorReason?: string;
  rawResponse?: any;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  private readonly storeId: string;
  private readonly storePasswd: string;
  private readonly apiUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly paymentsStore: PaymentsStore,
  ) {
    this.storeId =
      this.configService.get<string>('SSLCOMMERZ_STORE_ID') || 'testbox';
    this.storePasswd =
      this.configService.get<string>('SSLCOMMERZ_STORE_SECRET') || 'testpass';

    const isSandbox =
      this.configService.get<string>('SSLCOMMERZ_IS_SANDBOX') !== 'false';
    this.apiUrl = isSandbox
      ? 'https://sandbox.sslcommerz.com'
      : 'https://securepay.sslcommerz.com';
  }

  /**
   * Validates the SSLCommerz IPN signature.
   */
  private validateIpnSignature(ipnData: Record<string, string>): boolean {
    const { verify_sign, verify_sign_sha2, verify_key, ...rest } = ipnData;

    if (!verify_sign && !verify_sign_sha2) {
      this.logger.warn(
        'IPN missing both verify_sign and verify_sign_sha2 — rejecting',
      );
      return false;
    }
    if (!verify_key) {
      this.logger.warn('IPN missing verify_key — rejecting');
      return false;
    }

    const keys = verify_key.split(',').map((k) => k.trim());
    const parts = keys.map((key) => `${key}=${ipnData[key] ?? ''}`);
    const baseHashString = parts.join('&');

    let isValid = false;

    const safeEqual = (a: string, b: string): boolean => {
      const ab = Buffer.from(String(a));
      const bb = Buffer.from(String(b));
      return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
    };

    if (verify_sign_sha2) {
      const hashStringSha2 = `${baseHashString}&store_passwd=${this.storePasswd}`;
      const computedSha2 = crypto
        .createHash('sha256')
        .update(hashStringSha2)
        .digest('hex');

      if (safeEqual(computedSha2, verify_sign_sha2)) {
        isValid = true;
      } else {
        this.logger.warn('SHA256 signature mismatch on IPN.');
      }
    }

    if (!isValid && verify_sign) {
      const hashStringMd5 = `${baseHashString}&store_passwd=${crypto.createHash('md5').update(this.storePasswd).digest('hex')}`;
      const computedMd5 = crypto
        .createHash('md5')
        .update(hashStringMd5)
        .digest('hex');

      if (safeEqual(computedMd5, verify_sign)) {
        isValid = true;
      } else {
        this.logger.warn('MD5 signature mismatch on IPN.');
      }
    }

    if (!isValid) {
      this.logger.warn('IPN signature mismatch — possible spoofing attempt.');
    }
    return isValid;
  }

  async initiateCod(userId: string, orderId: string) {
    const order = await this.paymentsStore.findOrderById(orderId);

    if (!order) throw new EntityNotFoundError('Order not found');
    if (order.userId !== userId)
      throw new ForbiddenOperationError('Not your order');

    if (order.status === 'cancelled') {
      throw new InvalidOperationError(
        'Cannot initiate payment for a cancelled order',
      );
    }

    const nonRetryableStatuses = ['initiated', 'paid', 'refunded'];
    if (nonRetryableStatuses.includes(order.paymentStatus)) {
      throw new InvalidOperationError(
        'A payment has already been initiated or completed for this order',
      );
    }

    const payment = await this.paymentsStore.runTransaction(async (tx) => {
      const lockedOrder =
        (await this.paymentsStore.findOrderByIdForUpdate(orderId, tx)) || order;

      if (
        lockedOrder &&
        lockedOrder.paymentStatus &&
        nonRetryableStatuses.includes(lockedOrder.paymentStatus) &&
        lockedOrder.paymentStatus !== order.paymentStatus
      ) {
        throw new InvalidOperationError(
          'A payment has already been initiated or completed for this order',
        );
      }

      const pay = await this.paymentsStore.createPayment(
        {
          orderId,
          amount: lockedOrder?.totalAmount || order.totalAmount,
          method: 'COD',
          status: 'pending',
        },
        tx,
      );

      await this.paymentsStore.updateOrderStatus(
        orderId,
        { paymentStatus: 'initiated' },
        tx,
      );

      return pay;
    });

    return payment;
  }

  private static readonly STALE_PAYMENT_THRESHOLD_MS = 120_000; // 2 minutes

  async initiatePayment(
    userId: string,
    orderId: string,
    baseUrl: string,
    requestedMethod = 'sslcommerz',
  ) {
    const order = await this.paymentsStore.findOrderById(orderId);

    if (!order) throw new EntityNotFoundError('Order not found');
    if (order.userId !== userId)
      throw new ForbiddenOperationError('Not your order');

    if (order.status === 'cancelled') {
      throw new InvalidOperationError(
        'Cannot initiate payment for a cancelled order',
      );
    }

    if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') {
      throw new InvalidOperationError('This order has already been paid.');
    }

    if (order.paymentStatus === 'initiated') {
      const stalePayment =
        await this.paymentsStore.findLatestPaymentByOrderId(orderId);

      if (stalePayment && stalePayment.status === 'pending') {
        const isRecent =
          stalePayment.createdAt &&
          Date.now() - new Date(stalePayment.createdAt).getTime() <
            PaymentsService.STALE_PAYMENT_THRESHOLD_MS;

        if (isRecent) {
          throw new InvalidOperationError(
            'A payment session is currently in progress for this order. Please wait or complete payment on the gateway page.',
          );
        }

        await this.paymentsStore.runTransaction(async (tx) => {
          await this.paymentsStore.updatePaymentStatus(
            stalePayment.id,
            { status: 'failed' },
            tx,
          );
          await this.paymentsStore.updateOrderStatus(
            orderId,
            { paymentStatus: 'unpaid' },
            tx,
          );
        });
        this.logger.log(
          `Auto-cancelled stale payment ${stalePayment.id} for order ${orderId} — allowing retry.`,
        );
      } else {
        throw new InvalidOperationError(
          'A payment is already in progress for this order. Please wait or contact support.',
        );
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

    const user = await this.paymentsStore.findUserById(userId);
    if (!user) throw new EntityNotFoundError('User not found');

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

    let createdPayment: any;
    await this.paymentsStore.runTransaction(async (tx) => {
      const lockedOrder =
        (await this.paymentsStore.findOrderByIdForUpdate(orderId, tx)) || order;

      if (
        lockedOrder &&
        (lockedOrder.paymentStatus === 'paid' ||
          lockedOrder.paymentStatus === 'refunded')
      ) {
        throw new InvalidOperationError('This order has already been paid.');
      }

      if (lockedOrder && lockedOrder.status === 'cancelled') {
        throw new InvalidOperationError(
          'Cannot initiate payment for a cancelled order',
        );
      }

      if (lockedOrder && lockedOrder.paymentStatus === 'initiated') {
        const latestPending =
          await this.paymentsStore.findLatestPendingPaymentByOrderId(
            orderId,
            tx,
          );
        if (latestPending) {
          const isRecent =
            !latestPending.createdAt ||
            Date.now() - new Date(latestPending.createdAt).getTime() <
              PaymentsService.STALE_PAYMENT_THRESHOLD_MS;
          if (isRecent) {
            throw new InvalidOperationError(
              'A payment is already in progress for this order. Please wait or complete payment on the gateway page.',
            );
          }
          await this.paymentsStore.updatePaymentStatus(
            latestPending.id,
            { status: 'failed' },
            tx,
          );
        }
      }

      createdPayment = await this.paymentsStore.createPayment(
        {
          orderId,
          amount: lockedOrder?.totalAmount || order.totalAmount,
          method: methodValue,
          transactionId: tranId,
          status: 'pending',
        },
        tx,
      );

      await this.paymentsStore.updateOrderStatus(
        orderId,
        { paymentStatus: 'initiated' },
        tx,
      );
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
      cus_add1: 'Dhaka',
      cus_city: 'Dhaka',
      cus_postcode: '1000',
      cus_country: 'Bangladesh',
      cus_phone: user.phone || '01700000000',
      shipping_method: 'NO',
      product_name: 'Gramoz Order',
      product_category: 'E-Commerce',
      product_profile: 'general',
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
        signal: AbortSignal.timeout(10_000),
      });

      const data = await response.json();

      if (data.status === 'SUCCESS') {
        return { gatewayUrl: data.GatewayPageURL };
      } else {
        this.logger.error(
          'SSLCommerz Init Error: non-SUCCESS status returned by gateway',
        );
        if (createdPayment) {
          await this.paymentsStore
            .runTransaction(async (tx) => {
              await this.paymentsStore.updatePaymentStatus(
                createdPayment.id,
                { status: 'failed', gatewayResponse: data },
                tx,
              );
              await this.paymentsStore.updateOrderStatus(
                orderId,
                { paymentStatus: 'unpaid' },
                tx,
              );
            })
            .catch((e) =>
              this.logger.error(
                'Failed to clean up aborted payment initiation',
                e,
              ),
            );
        }
        throw new InvalidOperationError('Could not connect to payment gateway');
      }
    } catch (error) {
      if (error instanceof InvalidOperationError) {
        throw error;
      }
      this.logger.error('SSLCommerz Fetch Error during session init');
      if (createdPayment) {
        await this.paymentsStore
          .runTransaction(async (tx) => {
            await this.paymentsStore.updatePaymentStatus(
              createdPayment.id,
              { status: 'failed' },
              tx,
            );
            await this.paymentsStore.updateOrderStatus(
              orderId,
              { paymentStatus: 'unpaid' },
              tx,
            );
          })
          .catch((e) =>
            this.logger.error(
              'Failed to clean up aborted payment initiation',
              e,
            ),
          );
      }
      throw new InvalidOperationError('Could not connect to payment gateway');
    }
  }

  async verifyPayment(ipnData: any) {
    const isValid = this.validateIpnSignature(ipnData);
    const { val_id, tran_id, status } = ipnData;

    if (!isValid) {
      if (val_id && status === 'VALID') {
        this.logger.warn(
          `IPN signature mismatch, but val_id is present. Proceeding to Validation API as fallback.`,
        );
      } else {
        this.logger.error(
          'IPN signature validation failed and no val_id present to verify — rejecting request',
        );
        return { success: false, message: 'Invalid IPN signature' };
      }
    }

    if (!val_id || status !== 'VALID') {
      return this.handleFailedPayment(tran_id, ipnData);
    }

    const validationUrl = `${this.apiUrl}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(val_id)}&store_id=${encodeURIComponent(this.storeId)}&store_passwd=${encodeURIComponent(this.storePasswd)}&v=1&format=json`;

    try {
      const response = await fetch(validationUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok !== undefined && !response.ok) {
        throw new Error(`Gateway returned HTTP status ${response.status}`);
      }
      const data = await response.json();

      if (data.status === 'VALID' || data.status === 'VALIDATED') {
        return this.handleSuccessfulPayment(tran_id, data);
      } else if (!isValid) {
        // Unauthenticated IPN + negative gateway validation: reject WITHOUT mutating state.
        this.logger.warn(
          `Unsigned IPN for ${tran_id} was not confirmed by the gateway (status=${String(data.status)}) — ignoring without state change.`,
        );
        return { success: false, message: 'Invalid IPN signature' };
      } else {
        return this.handleFailedPayment(tran_id, data);
      }
    } catch (error) {
      this.logger.error(
        'SSLCommerz Verification Error during validation API call',
      );
      throw new InvalidOperationError('Payment verification failed');
    }
  }

  private async handleSuccessfulPayment(tranId: string, validationData: any) {
    if (!tranId) {
      return { success: false, message: 'Transaction ID missing' };
    }

    // 1. Validate transaction ID match if provided by gateway
    if (validationData.tran_id && validationData.tran_id !== tranId) {
      this.logger.error(
        `Transaction ID mismatch for transaction ${tranId}: gateway reported ${validationData.tran_id} — rejecting.`,
      );
      return {
        success: false,
        message: 'Transaction ID mismatch — callback rejected',
      };
    }

    // 2. Validate currency if provided by gateway
    const gatewayCurrency = (
      validationData.currency_type ||
      validationData.currency ||
      ''
    ).toUpperCase();
    if (gatewayCurrency && gatewayCurrency !== 'BDT') {
      this.logger.error(
        `Currency mismatch for transaction ${tranId}: expected BDT, gateway reported ${gatewayCurrency} — rejecting.`,
      );
      return {
        success: false,
        message:
          'Payment currency mismatch — transaction rejected for security review',
      };
    }

    // Pre-lookup payment record to get orderId for canonical locking
    const existingPayment =
      await this.paymentsStore.findPaymentByTransactionId(tranId);

    if (!existingPayment) {
      this.logger.error(`Payment record not found for transaction ${tranId}`);
      throw new EntityNotFoundError('Payment record not found');
    }

    // 3. Validate amount against authoritative payment record
    const gatewayAmount = parseFloat(validationData.amount ?? '0');
    const expectedAmount = parseFloat(existingPayment.amount);
    if (
      isNaN(gatewayAmount) ||
      gatewayAmount <= 0 ||
      Math.abs(gatewayAmount - expectedAmount) > 0.01
    ) {
      this.logger.error(
        `Amount mismatch for transaction ${tranId}: expected ${expectedAmount} BDT, gateway reported ${gatewayAmount} BDT — rejecting.`,
      );
      return {
        success: false,
        message:
          'Payment amount mismatch — transaction rejected for security review',
      };
    }

    // 4. Validate order association if returned by gateway (value_a)
    if (
      validationData.value_a &&
      validationData.value_a !== existingPayment.orderId
    ) {
      this.logger.error(
        `Order ID mismatch for transaction ${tranId}: expected order ${existingPayment.orderId}, gateway reported ${validationData.value_a} — rejecting.`,
      );
      return {
        success: false,
        message: 'Order ID mismatch — callback rejected',
      };
    }

    return await this.paymentsStore.runTransaction(async (tx) => {
      // CANONICAL LOCK ORDER: Level 1 = orders, Level 2 = payments
      // 1. Lock ORDER row first
      const order = await this.paymentsStore.findOrderByIdForUpdate(
        existingPayment.orderId,
        tx,
      );

      // 2. Lock PAYMENT row second
      let payment: any;
      if (
        typeof this.paymentsStore.findPaymentByTransactionIdForUpdate ===
        'function'
      ) {
        payment = await this.paymentsStore.findPaymentByTransactionIdForUpdate(
          tranId,
          tx,
        );
      } else {
        payment = await this.paymentsStore.findPaymentByTransactionId(
          tranId,
          tx,
        );
      }

      if (!payment) throw new EntityNotFoundError('Payment record not found');

      // Idempotency check: duplicate callback
      if (payment.status === 'completed') {
        this.logger.warn(
          `Duplicate IPN received for already-completed transaction ${tranId} — ignoring.`,
        );
        return {
          success: true,
          message: 'Payment already processed (duplicate IPN ignored)',
        };
      }

      await this.paymentsStore.updatePaymentStatus(
        payment.id,
        {
          status: 'completed',
          gatewayResponse: validationData,
        },
        tx,
      );

      // If order was already cancelled (e.g. cancelled while payment was in-flight)
      if (order && order.status === 'cancelled') {
        this.logger.error(
          `Payment for order ${payment.orderId} completed successfully, but order was ALREADY CANCELLED. Recording paymentStatus as paid without reviving cancelled order to processing.`,
        );
        await this.paymentsStore.updateOrderStatus(
          payment.orderId,
          {
            paymentStatus: 'paid',
          },
          tx,
        );

        if (typeof this.paymentsStore.createOutboxEvent === 'function') {
          await this.paymentsStore.createOutboxEvent(
            {
              type: 'RECONCILIATION_REQUIRED',
              payload: {
                orderId: payment.orderId,
                paymentId: payment.id,
                transactionId: tranId,
                amount: payment.amount,
                reason:
                  'Late payment confirmed after order was cancelled or expired',
              },
              status: 'pending',
            },
            tx,
          );
        }

        return {
          success: true,
          message:
            'Payment received for cancelled order — reconciliation flagged',
        };
      }

      await this.paymentsStore.updateOrderStatus(
        payment.orderId,
        {
          status: 'processing',
          paymentStatus: 'paid',
        },
        tx,
      );

      return {
        success: true,
        message: 'Payment verified and order is now processing',
      };
    });
  }

  private async handleFailedPayment(tranId: string, ipnData: any) {
    if (!tranId) {
      return { success: false, message: 'Payment record not found' };
    }

    const existingPayment =
      await this.paymentsStore.findPaymentByTransactionId(tranId);

    if (!existingPayment) {
      return { success: false, message: 'Payment record not found' };
    }

    return await this.paymentsStore.runTransaction(async (tx) => {
      // CANONICAL LOCK ORDER: Level 1 = orders, Level 2 = payments
      // 1. Lock ORDER row first
      const order = await this.paymentsStore.findOrderByIdForUpdate(
        existingPayment.orderId,
        tx,
      );

      // 2. Lock PAYMENT row second
      let payment: any;
      if (
        typeof this.paymentsStore.findPaymentByTransactionIdForUpdate ===
        'function'
      ) {
        payment = await this.paymentsStore.findPaymentByTransactionIdForUpdate(
          tranId,
          tx,
        );
      } else {
        payment = await this.paymentsStore.findPaymentByTransactionId(
          tranId,
          tx,
        );
      }

      if (!payment) {
        return { success: false, message: 'Payment record not found' };
      }

      if (payment.status === 'completed' || payment.status === 'failed') {
        this.logger.warn(
          `Duplicate IPN for transaction ${tranId} with status '${payment.status}' — ignoring.`,
        );
        return {
          success: false,
          message: 'Payment already in terminal state (duplicate IPN ignored)',
        };
      }

      await this.paymentsStore.updatePaymentStatus(
        payment.id,
        {
          status: 'failed',
          gatewayResponse: ipnData,
        },
        tx,
      );

      // Do NOT demote order paymentStatus if order was already paid or cancelled
      if (
        order &&
        order.paymentStatus !== 'paid' &&
        order.status !== 'cancelled'
      ) {
        await this.paymentsStore.updateOrderStatus(
          payment.orderId,
          { paymentStatus: 'unpaid' },
          tx,
        );
      }

      return { success: false, message: 'Payment failed or cancelled' };
    });
  }

  async handleFailCallback(body: any): Promise<void> {
    const tranId: string | undefined = body?.tran_id;

    if (tranId) {
      await this.handleFailedPayment(tranId, body);
      return;
    }

    const orderId: string | undefined = body?.value_a;
    if (!orderId) {
      this.logger.warn(
        'Fail callback received without tran_id or value_a — cannot reset payment state.',
      );
      return;
    }

    const pendingPayment =
      await this.paymentsStore.findLatestPendingPaymentByOrderId(orderId);

    if (!pendingPayment) {
      this.logger.warn(
        `Fail fallback: no pending payment found for orderId ${orderId}`,
      );
      return;
    }

    await this.paymentsStore.runTransaction(async (tx) => {
      // CANONICAL LOCK ORDER: Level 1 = orders, Level 2 = payments
      const order = await this.paymentsStore.findOrderByIdForUpdate(
        orderId,
        tx,
      );
      if (!order) return;

      let payment: any = pendingPayment;
      if (
        pendingPayment.transactionId &&
        typeof this.paymentsStore.findPaymentByTransactionIdForUpdate ===
          'function'
      ) {
        payment =
          (await this.paymentsStore.findPaymentByTransactionIdForUpdate(
            pendingPayment.transactionId,
            tx,
          )) || pendingPayment;
      }

      if (payment.status === 'completed' || payment.status === 'failed') {
        return;
      }

      await this.paymentsStore.updatePaymentStatus(
        payment.id,
        {
          status: 'failed',
          gatewayResponse: body,
        },
        tx,
      );

      if (order.paymentStatus !== 'paid' && order.status !== 'cancelled') {
        await this.paymentsStore.updateOrderStatus(
          orderId,
          { paymentStatus: 'unpaid' },
          tx,
        );
      }
    });

    this.logger.log(
      `Fail fallback: reset order ${orderId} to 'unpaid' via value_a.`,
    );
  }

  async handleCancelCallback(body: any): Promise<void> {
    const tranId: string | undefined = body?.tran_id;

    if (tranId) {
      await this.handleFailedPayment(tranId, body);
      return;
    }

    const orderId: string | undefined = body?.value_a;
    if (!orderId) {
      this.logger.warn(
        'Cancel callback received without tran_id or value_a — cannot reset payment state.',
      );
      return;
    }

    const pendingPayment =
      await this.paymentsStore.findLatestPendingPaymentByOrderId(orderId);

    if (!pendingPayment) {
      this.logger.warn(
        `Cancel fallback: no payment found for orderId ${orderId}`,
      );
      return;
    }

    await this.paymentsStore.runTransaction(async (tx) => {
      // CANONICAL LOCK ORDER: Level 1 = orders, Level 2 = payments
      const order = await this.paymentsStore.findOrderByIdForUpdate(
        orderId,
        tx,
      );
      if (!order) return;

      let payment: any = pendingPayment;
      if (
        pendingPayment.transactionId &&
        typeof this.paymentsStore.findPaymentByTransactionIdForUpdate ===
          'function'
      ) {
        payment =
          (await this.paymentsStore.findPaymentByTransactionIdForUpdate(
            pendingPayment.transactionId,
            tx,
          )) || pendingPayment;
      }

      if (payment.status === 'completed' || payment.status === 'failed') {
        return;
      }

      await this.paymentsStore.updatePaymentStatus(
        payment.id,
        {
          status: 'failed',
          gatewayResponse: body,
        },
        tx,
      );

      if (order.paymentStatus !== 'paid' && order.status !== 'cancelled') {
        await this.paymentsStore.updateOrderStatus(
          orderId,
          { paymentStatus: 'unpaid' },
          tx,
        );
      }
    });

    this.logger.log(
      `Cancel fallback: reset order ${orderId} to 'unpaid' via value_a.`,
    );
  }

  /**
   * Initiates an external refund with SSLCommerz (or handles COD/mock).
   * Complies with REF-22-A through REF-22-J and TASK-22G Phase 2 invariants.
   * NOTE: A successful response ('initiated') indicates the gateway ACCEPTED the refund request.
   * It does NOT establish final financial settlement!
   */
  async initiateRefund(params: {
    paymentId: string;
    amount: number;
    reason: string;
    refundId: string;
  }): Promise<RefundInitiationResult> {
    const payment = await this.paymentsStore.findPaymentById(params.paymentId);
    if (!payment) {
      throw new EntityNotFoundError('Payment not found');
    }

    if (payment.status !== 'completed') {
      throw new InvalidOperationError(
        `Cannot refund payment with status '${payment.status}'. Only completed payments can be refunded.`,
      );
    }

    const paymentAmount = parseFloat(payment.amount);
    if (params.amount <= 0 || params.amount > paymentAmount) {
      throw new InvalidOperationError(
        `Refund amount (${params.amount}) must be positive and cannot exceed captured payment amount (${payment.amount})`,
      );
    }

    // Cash on Delivery orders are refunded via manual / physical cash return, NOT via SSLCommerz gateway
    if (payment.method?.toUpperCase() === 'COD') {
      this.logger.log(
        `COD refund for payment ${payment.id} processed locally without external gateway call.`,
      );
      return {
        success: true,
        status: 'initiated',
        refundRefId: `COD-REFUND-${params.refundId}`,
        rawResponse: { method: 'COD', local: true },
      };
    }

    // Extract bank transaction ID from gateway response or fallback
    const gatewayResp = (payment.gatewayResponse as any) || {};
    const bankTranId =
      gatewayResp.bank_tran_id || gatewayResp.val_id || payment.transactionId;

    if (!bankTranId) {
      throw new InvalidOperationError(
        'Captured payment does not contain an authoritative bank_tran_id for gateway refund',
      );
    }

    const endpoint = `${this.apiUrl}/validator/api/merchantTransIDvalidationAPI.php`;
    const queryParams = new URLSearchParams({
      bank_tran_id: bankTranId,
      store_id: this.storeId,
      store_passwd: this.storePasswd,
      refund_amount: params.amount.toFixed(2),
      refund_remarks: params.reason || 'Customer refund',
      refe_id: params.refundId,
      format: 'json',
    });

    try {
      const response = await fetch(`${endpoint}?${queryParams.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (!response.ok) {
        this.logger.warn(
          `SSLCommerz refund HTTP status ${response.status} for payment ${payment.id}. Marking as processing for reconciliation.`,
        );
        return {
          success: false,
          status: 'processing',
          bankTranId,
          errorReason: `Gateway returned HTTP status ${response.status}`,
          rawResponse: { httpStatus: response.status },
        };
      }

      const data: SSLCommerzRefundInitiationRaw = await response.json();
      this.logger.log(
        `SSLCommerz refund response for payment ${payment.id}: status=${data.status}, APIConnect=${data.APIConnect}`,
      );

      // PHASE 2 INVARIANT: Verify APIConnect authentication
      if (data.APIConnect !== 'DONE') {
        return {
          success: false,
          status: 'failed',
          bankTranId,
          errorReason: `Provider connection or authentication failed: APIConnect=${data.APIConnect || 'UNKNOWN'}${data.errorReason ? ` - ${data.errorReason}` : ''}`,
          rawResponse: data,
        };
      }

      // PHASE 2 INVARIANT: Validate bank transaction identity if returned
      if (data.bank_tran_id && data.bank_tran_id !== bankTranId) {
        return {
          success: false,
          status: 'failed',
          bankTranId,
          errorReason: `Bank transaction ID mismatch: expected ${bankTranId}, got ${data.bank_tran_id}`,
          rawResponse: data,
        };
      }

      // PHASE 2 INVARIANT: Map initiation status
      if (data.status === 'success') {
        if (!data.refund_ref_id) {
          return {
            success: false,
            status: 'failed',
            bankTranId,
            errorReason: 'Gateway indicated success but omitted refund_ref_id',
            rawResponse: data,
          };
        }
        return {
          success: true,
          status: 'initiated',
          refundRefId: data.refund_ref_id,
          bankTranId: data.bank_tran_id || bankTranId,
          rawResponse: data,
        };
      } else if (data.status === 'processing') {
        return {
          success: true,
          status: 'processing',
          refundRefId: data.refund_ref_id,
          bankTranId: data.bank_tran_id || bankTranId,
          rawResponse: data,
        };
      } else {
        return {
          success: false,
          status: 'failed',
          bankTranId,
          errorReason:
            data.errorReason ||
            (data as any).failedreason ||
            'Gateway rejected refund initiation',
          rawResponse: data,
        };
      }
    } catch (err: any) {
      this.logger.error(
        `SSLCommerz refund request failed/timed out for payment ${payment.id}: ${err.message}`,
      );
      // Timeout or network disconnect: Do NOT mark failed — keep as 'processing' so it is reconcilable without duplicate refunds
      return {
        success: false,
        status: 'processing',
        bankTranId,
        errorReason: `Provider timeout or network error: ${err.message}`,
        rawResponse: { timeout: true, error: err.message },
      };
    }
  }

  /**
   * Queries the authoritative settlement status of an initiated refund with SSLCommerz.
   * Follows official documentation: completed refund status is status: 'refunded'.
   * Invariants REF-G02 through REF-G08 enforced.
   */
  async queryRefundStatus(
    refundRefId: string,
    validation?: {
      expectedBankTranId?: string;
      expectedTranId?: string;
    },
  ): Promise<RefundInquiryResult> {
    const endpoint = `${this.apiUrl}/validator/api/merchantTransIDvalidationAPI.php`;
    const queryParams = new URLSearchParams({
      refund_ref_id: refundRefId,
      store_id: this.storeId,
      store_passwd: this.storePasswd,
      format: 'json',
    });

    try {
      const response = await fetch(`${endpoint}?${queryParams.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          status: 'transport_error',
          refundRefId,
          errorReason: `Gateway returned HTTP status ${response.status}`,
          rawResponse: { httpStatus: response.status },
        };
      }

      const data: SSLCommerzRefundInquiryRaw = await response.json();

      // PHASE 3 & 4 INVARIANT (REF-G07): Check APIConnect authentication
      if (data.APIConnect !== 'DONE') {
        return {
          success: false,
          status: 'failed_auth',
          refundRefId,
          errorReason: `Provider authentication or connection failed: APIConnect=${data.APIConnect || 'UNKNOWN'}${data.errorReason ? ` - ${data.errorReason}` : ''}`,
          rawResponse: data,
        };
      }

      // PHASE 3 & 4 INVARIANT (REF-G05): Validate refund_ref_id identity if returned
      if (data.refund_ref_id && data.refund_ref_id !== refundRefId) {
        return {
          success: false,
          status: 'invalid_identity',
          refundRefId,
          errorReason: `Provider returned mismatched refund_ref_id: expected ${refundRefId}, got ${data.refund_ref_id}`,
          rawResponse: data,
        };
      }

      // PHASE 3 & 4 INVARIANT (REF-G06): Validate bank transaction identity if specified
      if (
        validation?.expectedBankTranId &&
        data.bank_tran_id &&
        data.bank_tran_id !== validation.expectedBankTranId
      ) {
        return {
          success: false,
          status: 'invalid_identity',
          refundRefId,
          bankTranId: data.bank_tran_id,
          errorReason: `Provider returned mismatched bank_tran_id: expected ${validation.expectedBankTranId}, got ${data.bank_tran_id}`,
          rawResponse: data,
        };
      }

      // PHASE 3 & 4 INVARIANT (REF-G06): Validate merchant order transaction identity if specified
      if (
        validation?.expectedTranId &&
        data.tran_id &&
        data.tran_id !== validation.expectedTranId
      ) {
        return {
          success: false,
          status: 'invalid_identity',
          refundRefId,
          tranId: data.tran_id,
          errorReason: `Provider returned mismatched tran_id: expected ${validation.expectedTranId}, got ${data.tran_id}`,
          rawResponse: data,
        };
      }

      // PHASE 3 & 4 INVARIANT (REF-G03): Authoritative settlement confirmed
      if (data.status === 'refunded') {
        return {
          success: true,
          status: 'refunded',
          refundRefId: data.refund_ref_id || refundRefId,
          bankTranId: data.bank_tran_id,
          tranId: data.tran_id,
          initiatedOn: data.initiated_on,
          refundedOn: data.refunded_on,
          rawResponse: data,
        };
      } else if (data.status === 'processing') {
        // REF-G02: Still processing with bank
        return {
          success: true,
          status: 'processing',
          refundRefId: data.refund_ref_id || refundRefId,
          bankTranId: data.bank_tran_id,
          tranId: data.tran_id,
          rawResponse: data,
        };
      } else if (data.status === 'cancelled') {
        // Cancelled by bank/gateway
        return {
          success: false,
          status: 'cancelled',
          refundRefId: data.refund_ref_id || refundRefId,
          errorReason:
            data.errorReason || 'Refund was cancelled by provider/bank',
          rawResponse: data,
        };
      } else if (data.status === 'success') {
        // REF-G04: An inquiry returning 'success' is an initiation-style status, NOT final settlement!
        return {
          success: false,
          status: 'unknown_status',
          refundRefId: data.refund_ref_id || refundRefId,
          errorReason:
            "Unexpected 'success' status returned on inquiry; authoritative settlement requires status='refunded'",
          rawResponse: data,
        };
      } else {
        // REF-G08: Unknown, missing, or malformed status
        return {
          success: false,
          status: 'unknown_status',
          refundRefId: data.refund_ref_id || refundRefId,
          errorReason: `Unknown or malformed gateway inquiry status: '${data.status}'`,
          rawResponse: data,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        status: 'transport_error',
        refundRefId,
        errorReason: `Query timeout or network error: ${err.message}`,
        rawResponse: { timeout: true, error: err.message },
      };
    }
  }
}

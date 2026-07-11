import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { EntityNotFoundError, InvalidOperationError, ForbiddenOperationError } from '../../common/errors/domain.errors';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PaymentsStore } from './payments.store';

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
      this.logger.warn('IPN missing both verify_sign and verify_sign_sha2 — rejecting');
      return false;
    }
    if (!verify_key) {
      this.logger.warn('IPN missing verify_key — rejecting');
      return false;
    }

    const keys = verify_key.split(',').map(k => k.trim());
    const parts = keys.map((key) => `${key}=${ipnData[key] ?? ''}`);
    const baseHashString = parts.join('&');

    let isValid = false;

    if (verify_sign_sha2) {
      const hashStringSha2 = `${baseHashString}&store_passwd=${this.storePasswd}`;
      const computedSha2 = crypto.createHash('sha256').update(hashStringSha2).digest('hex');
      
      if (computedSha2 === verify_sign_sha2) {
        isValid = true;
      } else {
        this.logger.warn(`SHA256 mismatch. Expected: ${computedSha2}, Got: ${verify_sign_sha2}`);
      }
    }

    if (!isValid && verify_sign) {
      const hashStringMd5 = `${baseHashString}&store_passwd=${crypto.createHash('md5').update(this.storePasswd).digest('hex')}`;
      const computedMd5 = crypto.createHash('md5').update(hashStringMd5).digest('hex');
      
      if (computedMd5 === verify_sign) {
        isValid = true;
      } else {
        this.logger.warn(`MD5 mismatch. Expected: ${computedMd5}, Got: ${verify_sign}`);
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
    if (order.userId !== userId) throw new ForbiddenOperationError('Not your order');

    const nonRetryableStatuses = ['initiated', 'paid', 'refunded'];
    if (nonRetryableStatuses.includes(order.paymentStatus)) {
      throw new InvalidOperationError(
        'A payment has already been initiated or completed for this order',
      );
    }

    const [payment] = await this.paymentsStore.runTransaction(async (tx) => {
      const pay = await this.paymentsStore.createPayment({
        orderId,
        amount: order.totalAmount,
        method: 'COD',
        status: 'pending',
      }, tx);

      await this.paymentsStore.updateOrderStatus(orderId, { paymentStatus: 'initiated' }, tx);

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
    const order = await this.paymentsStore.findOrderById(orderId);

    if (!order) throw new EntityNotFoundError('Order not found');
    if (order.userId !== userId) throw new ForbiddenOperationError('Not your order');

    if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') {
      throw new InvalidOperationError('This order has already been paid.');
    }

    if (order.paymentStatus === 'initiated') {
      const stalePayment = await this.paymentsStore.findLatestPaymentByOrderId(orderId);

      if (stalePayment && stalePayment.status === 'pending') {
        await this.paymentsStore.runTransaction(async (tx) => {
          await this.paymentsStore.updatePaymentStatus(stalePayment.id, { status: 'failed' }, tx);
          await this.paymentsStore.updateOrderStatus(orderId, { paymentStatus: 'unpaid' }, tx);
        });
        this.logger.log(
          `Auto-cancelled stale payment ${stalePayment.id} for order ${orderId} — allowing retry.`,
        );
      } else {
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

    await this.paymentsStore.runTransaction(async (tx) => {
      await this.paymentsStore.createPayment({
        orderId,
        amount: order.totalAmount,
        method: methodValue,
        transactionId: tranId,
        status: 'pending',
      }, tx);

      await this.paymentsStore.updateOrderStatus(orderId, { paymentStatus: 'initiated' }, tx);
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
    const isValid = this.validateIpnSignature(ipnData);
    const { val_id, tran_id, status } = ipnData;

    if (!isValid) {
      if (val_id && status === 'VALID') {
        this.logger.warn(`IPN signature mismatch, but val_id is present. Proceeding to Validation API as fallback.`);
      } else {
        this.logger.error('IPN signature validation failed and no val_id present to verify — rejecting request');
        return { success: false, message: 'Invalid IPN signature' };
      }
    }

    if (!val_id || status !== 'VALID') {
      return this.handleFailedPayment(tran_id, ipnData);
    }

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
    const payment = await this.paymentsStore.findPaymentByTransactionId(tranId);

    if (!payment) throw new EntityNotFoundError('Payment record not found');

    if (payment.status === 'completed') {
      this.logger.warn(
        `Duplicate IPN received for already-completed transaction ${tranId} — ignoring.`,
      );
      return {
        success: true,
        message: 'Payment already processed (duplicate IPN ignored)',
      };
    }

    const gatewayAmount = parseFloat(validationData.amount ?? '0');
    const expectedAmount = parseFloat(payment.amount);
    if (Math.abs(gatewayAmount - expectedAmount) > 0.01) {
      this.logger.error(
        `Amount mismatch for transaction ${tranId}: ` +
        `expected ${expectedAmount} BDT, gateway reported ${gatewayAmount} BDT — rejecting.`,
      );
      return {
        success: false,
        message: 'Payment amount mismatch — transaction rejected for security review',
      };
    }

    await this.paymentsStore.runTransaction(async (tx) => {
      await this.paymentsStore.updatePaymentStatus(payment.id, {
        status: 'completed',
        gatewayResponse: validationData,
      }, tx);

      await this.paymentsStore.updateOrderStatus(payment.orderId, {
        status: 'processing',
        paymentStatus: 'paid',
      }, tx);
    });

    return {
      success: true,
      message: 'Payment verified and order is now processing',
    };
  }

  private async handleFailedPayment(tranId: string, ipnData: any) {
    const payment = await this.paymentsStore.findPaymentByTransactionId(tranId);

    if (!payment)
      return { success: false, message: 'Payment record not found' };

    if (payment.status === 'completed' || payment.status === 'failed') {
      this.logger.warn(
        `Duplicate IPN for transaction ${tranId} with status '${payment.status}' — ignoring.`,
      );
      return { success: false, message: 'Payment already in terminal state (duplicate IPN ignored)' };
    }

    await this.paymentsStore.runTransaction(async (tx) => {
      await this.paymentsStore.updatePaymentStatus(payment.id, {
        status: 'failed',
        gatewayResponse: ipnData,
      }, tx);

      await this.paymentsStore.updateOrderStatus(payment.orderId, { paymentStatus: 'unpaid' }, tx);
    });

    return { success: false, message: 'Payment failed or cancelled' };
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

    const pendingPayment = await this.paymentsStore.findLatestPendingPaymentByOrderId(orderId);

    if (!pendingPayment) {
      this.logger.warn(`Cancel fallback: no payment found for orderId ${orderId}`);
      return;
    }

    await this.paymentsStore.runTransaction(async (tx) => {
      await this.paymentsStore.updatePaymentStatus(pendingPayment.id, {
        status: 'failed',
        gatewayResponse: body,
      }, tx);

      await this.paymentsStore.updateOrderStatus(orderId, { paymentStatus: 'unpaid' }, tx);
    });

    this.logger.log(`Cancel fallback: reset order ${orderId} to 'unpaid' via value_a.`);
  }
}

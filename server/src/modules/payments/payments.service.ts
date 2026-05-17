import { Injectable, Inject, NotFoundException, BadRequestException, Logger, ForbiddenException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
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
    this.storeId = this.configService.get<string>('SSLCOMMERZ_STORE_ID') || 'testbox';
    this.storePasswd = this.configService.get<string>('SSLCOMMERZ_STORE_SECRET') || 'testpass';
    this.isSandbox = this.configService.get<string>('SSLCOMMERZ_IS_SANDBOX') !== 'false';
    
    this.apiUrl = this.isSandbox
      ? 'https://sandbox.sslcommerz.com'
      : 'https://securepay.sslcommerz.com';
  }

  async initiatePayment(userId: string, orderId: string, baseUrl: string) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('Not your order');
    if (order.status !== 'pending') throw new BadRequestException('Order is already paid or cancelled');

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const tranId = `TRN_${Date.now()}_${orderId.substring(0, 5)}`;

    // Create a pending payment record
    await this.db.insert(schema.payments).values({
      orderId,
      amount: order.totalAmount,
      method: 'SSLCommerz',
      transactionId: tranId,
      status: 'pending',
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
    });

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
        throw new BadRequestException('Payment gateway initialization failed');
      }
    } catch (error) {
      this.logger.error('SSLCommerz Fetch Error:', error);
      throw new BadRequestException('Could not connect to payment gateway');
    }
  }

  async verifyPayment(ipnData: any) {
    const { val_id, tran_id, status, amount } = ipnData;

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
      throw new BadRequestException('Payment verification failed');
    }
  }

  private async handleSuccessfulPayment(tranId: string, validationData: any) {
    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.transactionId, tranId));

    if (!payment) throw new NotFoundException('Payment record not found');

    // Run in transaction to update both payment and order status
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
        .set({ status: 'processing', updatedAt: new Date() })
        .where(eq(schema.orders.id, payment.orderId));
    });

    return { success: true, message: 'Payment verified and order is now processing' };
  }

  private async handleFailedPayment(tranId: string, ipnData: any) {
    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.transactionId, tranId));

    if (!payment) return { success: false, message: 'Payment record not found' };

    await this.db
      .update(schema.payments)
      .set({
        status: 'failed',
        gatewayResponse: ipnData,
        updatedAt: new Date(),
      })
      .where(eq(schema.payments.id, payment.id));

    return { success: false, message: 'Payment failed or cancelled' };
  }
}



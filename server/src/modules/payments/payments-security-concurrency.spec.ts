/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@database/schema';
import * as crypto from 'crypto';
import { PaymentsService } from './payments.service';
import { PaymentsStore } from './payments.store';
import { OrdersService } from '../orders/orders.service';
import { OrdersStore } from '../orders/orders.store';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltyStore } from '../loyalty/loyalty.store';
import { SettingsService } from '../settings/settings.service';
import { SettingsStore } from '../settings/settings.store';
import { PromosService } from '../promos/promos.service';
import { CourierService } from '../courier/courier.service';
import {
  InvalidOperationError,
  EntityNotFoundError,
} from '../../common/errors/domain.errors';

describe('TASK-18: Real PostgreSQL Payment Concurrency, Gateway Security & Financial Integrity Suite', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let paymentsStore: PaymentsStore;
  let paymentsService: PaymentsService;
  let ordersStore: OrdersStore;
  let ordersService: OrdersService;
  let loyaltyStore: LoyaltyStore;
  let loyaltyService: LoyaltyService;
  let settingsStore: SettingsStore;
  let settingsService: SettingsService;
  let promosService: PromosService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const STORE_SECRET = 'test-secret';

  // Helper to generate a valid SSLCommerz IPN MD5 signature
  const generateMd5Sig = (
    ipnData: Record<string, string>,
    secret = STORE_SECRET,
  ) => {
    const keys = ipnData.verify_key.split(',').map((k) => k.trim());
    const parts = keys.map((key) => `${key}=${ipnData[key] ?? ''}`);
    const baseHash = parts.join('&');
    const hashedPasswd = crypto.createHash('md5').update(secret).digest('hex');
    const hashString = `${baseHash}&store_passwd=${hashedPasswd}`;
    return crypto.createHash('md5').update(hashString).digest('hex');
  };

  // Helper to generate a valid SSLCommerz IPN SHA256 signature
  const generateSha256Sig = (
    ipnData: Record<string, string>,
    secret = STORE_SECRET,
  ) => {
    const keys = ipnData.verify_key.split(',').map((k) => k.trim());
    const parts = keys.map((key) => `${key}=${ipnData[key] ?? ''}`);
    const baseHash = parts.join('&');
    const hashString = `${baseHash}&store_passwd=${secret}`;
    return crypto.createHash('sha256').update(hashString).digest('hex');
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 30, // ample connections for high-concurrency races
    });
    db = drizzle(pool, { schema });

    paymentsStore = new PaymentsStore(db as any);
    ordersStore = new OrdersStore(db as any);
    loyaltyStore = new LoyaltyStore(db as any);
    settingsStore = new SettingsStore(db as any);

    settingsService = new SettingsService(settingsStore);
    loyaltyService = new LoyaltyService(loyaltyStore, settingsService);
    promosService = new PromosService(db as any);

    const mockCourierService = {
      calculateCharge: jest.fn().mockResolvedValue({ charge: 60 }),
      createConsignment: jest
        .fn()
        .mockResolvedValue({ tracking_code: 'TRK-18' }),
    } as unknown as CourierService;

    ordersService = new OrdersService(
      ordersStore,
      promosService,
      loyaltyService,
      settingsService,
      mockCourierService,
    );

    const mockConfig = {
      get: (key: string, defaultVal?: unknown) => {
        const values: Record<string, unknown> = {
          SSLCOMMERZ_STORE_ID: 'test-store',
          SSLCOMMERZ_STORE_SECRET: STORE_SECRET,
          SSLCOMMERZ_IS_SANDBOX: 'true',
        };
        return values[key] ?? defaultVal;
      },
    } as any;

    paymentsService = new PaymentsService(mockConfig, paymentsStore);
  });

  afterAll(async () => {
    try {
      for (const uid of createdUserIds) {
        await pool.query(
          "DELETE FROM outbox_events WHERE payload->>'userId' = $1",
          [uid],
        );
        await pool.query('DELETE FROM refunds WHERE requested_by = $1', [uid]);
        await pool.query(
          'DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)',
          [uid],
        );
        await pool.query(
          'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)',
          [uid],
        );
        await pool.query('DELETE FROM orders WHERE user_id = $1', [uid]);
        await pool.query('DELETE FROM addresses WHERE user_id = $1', [uid]);
        await pool.query('DELETE FROM users WHERE id = $1', [uid]);
      }
      for (const cid of createdCategoryIds) {
        await pool.query('DELETE FROM categories WHERE id = $1', [cid]);
      }
    } finally {
      await pool.end().catch(() => {});
    }
  });

  async function createTestCustomer(): Promise<{
    id: string;
    fullName: string;
    email: string;
    phone: string;
  }> {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `task18_cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@example.com`,
        passwordHash: '$2b$10$insecureplaceholderfortests',
        fullName: 'Payment Tester',
        phone: '01799887766',
        isPhoneVerified: true,
        role: 'customer',
      })
      .returning();
    createdUserIds.push(user.id);
    return user;
  }

  async function createTestOrder(
    userId: string,
    amount = '1000.00',
    status: schema.Order['status'] = 'pending',
    paymentStatus: schema.Order['paymentStatus'] = 'unpaid',
  ): Promise<schema.Order> {
    const [addr] = await db
      .insert(schema.addresses)
      .values({
        userId,
        title: 'Home',
        addressLine1: 'Road 18, Block D',
        city: 'Dhaka',
        isDefault: true,
      })
      .returning();

    const [order] = await db
      .insert(schema.orders)
      .values({
        userId,
        totalAmount: amount,
        shippingAddressId: addr.id,
        status,
        paymentStatus,
      })
      .returning();
    createdOrderIds.push(order.id);
    return order;
  }

  async function createTestPayment(
    orderId: string,
    amount: string,
    tranId: string,
    status: schema.Payment['status'] = 'pending',
  ): Promise<schema.Payment> {
    const [payment] = await db
      .insert(schema.payments)
      .values({
        orderId,
        amount,
        method: 'SSLCommerz',
        transactionId: tranId,
        status,
      })
      .returning();
    return payment;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 4: IPN AND CALLBACK SECURITY VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('PHASE 4: IPN and Gateway Security Verification', () => {
    it('SEC-18-1: Rejects IPN callback with forged / tampered amount', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '1500.00');
      const tranId = `TRN_TAMPER_AMT_${Date.now()}`;
      await createTestPayment(order.id, '1500.00', tranId);

      const ipnData = {
        val_id: 'val_tamper_1',
        tran_id: tranId,
        status: 'VALID',
        amount: '10.00', // tampered amount
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateSha256Sig(ipnData),
      };

      // Mock gateway validation server returning 10.00
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'VALID',
            amount: '10.00',
            currency: 'BDT',
            tran_id: tranId,
          }),
      });

      const result = await paymentsService.verifyPayment(signedIpn);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/amount mismatch/i);

      // Verify payment was NOT marked completed
      const paymentInDb =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(paymentInDb?.status).toBe('pending');
      const orderInDb = await ordersStore.findOrderById(order.id);
      expect(orderInDb?.paymentStatus).toBe('unpaid');
    });

    it('SEC-18-2: Rejects IPN callback with tampered / unexpected currency', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '800.00');
      const tranId = `TRN_TAMPER_CURR_${Date.now()}`;
      await createTestPayment(order.id, '800.00', tranId);

      const ipnData = {
        val_id: 'val_tamper_curr',
        tran_id: tranId,
        status: 'VALID',
        amount: '800.00',
        currency: 'USD',
        verify_key: 'tran_id,amount,currency',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateSha256Sig(ipnData),
      };

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'VALID',
            amount: '800.00',
            currency: 'EUR',
            tran_id: tranId,
          }),
      });

      const result = await paymentsService.verifyPayment(signedIpn);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/currency mismatch/i);

      const paymentInDb =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(paymentInDb?.status).toBe('pending');
    });

    it('SEC-18-3: Rejects IPN callback with forged transaction ID substitution', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '500.00');
      const tranId = `TRN_LEGIT_${Date.now()}`;
      await createTestPayment(order.id, '500.00', tranId);

      const ipnData = {
        val_id: 'val_sub_1',
        tran_id: tranId,
        status: 'VALID',
        amount: '500.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateSha256Sig(ipnData),
      };

      // Gateway returns a different transaction ID
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'VALID',
            amount: '500.00',
            currency: 'BDT',
            tran_id: 'TRN_DIFFERENT_SUBSTITUTED',
          }),
      });

      const result = await paymentsService.verifyPayment(signedIpn);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/transaction ID mismatch/i);

      const paymentInDb =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(paymentInDb?.status).toBe('pending');
    });

    it("SEC-18-4: Rejects IPN callback referencing another customer's order (value_a mismatch)", async () => {
      const customerA = await createTestCustomer();
      const customerB = await createTestCustomer();
      const orderA = await createTestOrder(customerA.id, '600.00');
      const orderB = await createTestOrder(customerB.id, '600.00');
      const tranId = `TRN_ORD_MISMATCH_${Date.now()}`;
      await createTestPayment(orderA.id, '600.00', tranId);

      const ipnData = {
        val_id: 'val_ord_1',
        tran_id: tranId,
        status: 'VALID',
        amount: '600.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateSha256Sig(ipnData),
      };

      // Gateway validation reports orderB.id in value_a
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'VALID',
            amount: '600.00',
            currency: 'BDT',
            tran_id: tranId,
            value_a: orderB.id,
          }),
      });

      const result = await paymentsService.verifyPayment(signedIpn);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/order ID mismatch/i);

      const paymentInDb =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(paymentInDb?.status).toBe('pending');
    });

    it('SEC-18-5: Handles gateway validation timeout gracefully without partially committing state', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '450.00');
      const tranId = `TRN_TIMEOUT_${Date.now()}`;
      await createTestPayment(order.id, '450.00', tranId);

      const ipnData = {
        val_id: 'val_timeout',
        tran_id: tranId,
        status: 'VALID',
        amount: '450.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateSha256Sig(ipnData),
      };

      // Simulate gateway timeout
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('Gateway timeout after 10000ms'));

      await expect(paymentsService.verifyPayment(signedIpn)).rejects.toThrow(
        /Payment verification failed/i,
      );

      const paymentInDb =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(paymentInDb?.status).toBe('pending');
      const orderInDb = await ordersStore.findOrderById(order.id);
      expect(orderInDb?.paymentStatus).toBe('unpaid');
    });

    it('SEC-18-6: Handles gateway HTTP 502/500 error gracefully', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '300.00');
      const tranId = `TRN_HTTP_ERR_${Date.now()}`;
      await createTestPayment(order.id, '300.00', tranId);

      const ipnData = {
        val_id: 'val_http_err',
        tran_id: tranId,
        status: 'VALID',
        amount: '300.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateSha256Sig(ipnData),
      };

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      });

      await expect(paymentsService.verifyPayment(signedIpn)).rejects.toThrow(
        /Payment verification failed/i,
      );

      const paymentInDb =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(paymentInDb?.status).toBe('pending');
    });

    it('SEC-18-7: TASK-26: Unsigned/spoofed IPN with status=FAILED is rejected without mutating payment or order to failed', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '300.00');
      const tranId = `TRN_SPOOF_FAIL_${Date.now()}`;
      await createTestPayment(order.id, '300.00', tranId);

      const fakeIpn = {
        val_id: '',
        tran_id: tranId,
        status: 'FAILED',
        amount: '300.00',
        verify_sign_sha2: 'invalid-signature',
      };

      const result = await paymentsService.verifyPayment(fakeIpn);
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid IPN signature');

      const paymentInDb =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(paymentInDb?.status).toBe('pending');
      const orderInDb = await ordersStore.findOrderById(order.id);
      expect(orderInDb?.paymentStatus).toBe('unpaid');
    });

    it('SEC-18-8: TASK-26: Unsigned IPN where gateway validator returns non-VALID is rejected without state mutation', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '300.00');
      const tranId = `TRN_SPOOF_GW_${Date.now()}`;
      await createTestPayment(order.id, '300.00', tranId);

      const unauthenticatedIpn = {
        val_id: 'val_spoofed',
        tran_id: tranId,
        status: 'VALID',
        amount: '300.00',
        verify_sign_sha2: 'invalid-signature',
      };

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'FAILED' }),
      });

      const result = await paymentsService.verifyPayment(unauthenticatedIpn);
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid IPN signature');

      const paymentInDb =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(paymentInDb?.status).toBe('pending');
      const orderInDb = await ordersStore.findOrderById(order.id);
      expect(orderInDb?.paymentStatus).toBe('unpaid');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 5: REAL POSTGRESQL 16 PAYMENT CONCURRENCY TESTING (CONC-18-A to CONC-18-G)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('PHASE 5: PostgreSQL Payment Concurrency Verification', () => {
    // CONC-18-A: Duplicate Success Notifications (10 simultaneous IPN callbacks for same transaction)
    it('CONC-18-A: Duplicate Success Notifications — 10 concurrent success notifications result in exactly 1 logical success', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '2000.00');
      const tranId = `CONC_18_A_${Date.now()}`;
      await createTestPayment(order.id, '2000.00', tranId);

      const validationPayload = {
        status: 'VALIDATED',
        amount: '2000.00',
        currency: 'BDT',
        tran_id: tranId,
        value_a: order.id,
      };

      // 10 concurrent success handler executions
      const results = await Promise.all(
        Array.from({ length: 10 }).map(() =>
          (paymentsService as any).handleSuccessfulPayment(
            tranId,
            validationPayload,
          ),
        ),
      );

      // All 10 returned success: true (first processed, other 9 returned duplicate ignored)
      for (const res of results) {
        expect(res.success).toBe(true);
      }

      // Exactly 1 returned 'Payment verified and order is now processing'
      const initialSuccess = results.filter((r) =>
        r.message.includes('order is now processing'),
      );
      const duplicateSuccess = results.filter((r) =>
        r.message.includes('duplicate IPN ignored'),
      );

      expect(initialSuccess.length).toBe(1);
      expect(duplicateSuccess.length).toBe(9);

      // Verify final database state
      const payment = await paymentsStore.findPaymentByTransactionId(tranId);
      expect(payment?.status).toBe('completed');

      const updatedOrder = await ordersStore.findOrderById(order.id);
      expect(updatedOrder?.status).toBe('processing');
      expect(updatedOrder?.paymentStatus).toBe('paid');
    });

    // CONC-18-B: Success Versus Failure (Race successful IPN vs failed IPN)
    it('CONC-18-B: Success Versus Failure — late or concurrent failure cannot demote a verified successful payment', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '1250.00');
      const tranId = `CONC_18_B_${Date.now()}`;
      await createTestPayment(order.id, '1250.00', tranId);

      const successPayload = {
        status: 'VALIDATED',
        amount: '1250.00',
        currency: 'BDT',
        tran_id: tranId,
      };
      const failurePayload = {
        status: 'FAILED',
        tran_id: tranId,
        failedreason: 'Customer cancelled transaction at gateway',
      };

      // Fire success and failure concurrently
      const [succRes, failRes] = await Promise.all([
        (paymentsService as any).handleSuccessfulPayment(
          tranId,
          successPayload,
        ),
        (paymentsService as any).handleFailedPayment(tranId, failurePayload),
      ]);

      // Regardless of which acquired the row lock first:
      // If success committed, the failure handler should have seen status === 'completed' and ignored it!
      const paymentInDb =
        await paymentsStore.findPaymentByTransactionId(tranId);
      const orderInDb = await ordersStore.findOrderById(order.id);

      if (paymentInDb?.status === 'completed') {
        expect(orderInDb?.paymentStatus).toBe('paid');
        expect(orderInDb?.status).toBe('processing');
      } else {
        // If failure ran first, payment is failed and order unpaid
        expect(paymentInDb?.status).toBe('failed');
        expect(orderInDb?.paymentStatus).toBe('unpaid');
      }
    });

    // CONC-18-C: Payment Confirmation Versus Order Cancellation Race
    it('CONC-18-C: Payment Versus Cancellation — payment confirming after cancellation preserves audit and generates RECONCILIATION_REQUIRED', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '990.00', 'pending');
      const tranId = `CONC_18_C_${Date.now()}`;
      await createTestPayment(order.id, '990.00', tranId);

      const successPayload = {
        status: 'VALIDATED',
        amount: '990.00',
        currency: 'BDT',
        tran_id: tranId,
      };

      // Execute cancellation and payment confirmation concurrently
      const results = await Promise.allSettled([
        ordersService.cancelOrder(
          customer.id,
          order.id,
          'Customer clicked Cancel',
        ),
        (paymentsService as any).handleSuccessfulPayment(
          tranId,
          successPayload,
        ),
      ]);

      // Both operations must settle cleanly without throwing deadlock or unhandled errors
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');

      const finalOrder = await ordersStore.findOrderById(order.id);
      const finalPayment =
        await paymentsStore.findPaymentByTransactionId(tranId);

      expect(finalPayment?.status).toBe('completed');

      // If the order was cancelled, it MUST NOT be revived to 'processing'!
      if (finalOrder?.status === 'cancelled') {
        expect(finalOrder?.paymentStatus).toBe('paid');

        // Actionable outbox event (RECONCILIATION_REQUIRED or REFUND_REQUIRED) must exist in DB
        const [outboxEvent] = await db
          .select()
          .from(schema.outboxEvents)
          .where(
            sql`${schema.outboxEvents.type} IN ('RECONCILIATION_REQUIRED', 'REFUND_REQUIRED') AND ${schema.outboxEvents.payload}->>'orderId' = ${order.id}`,
          );
        expect(outboxEvent).toBeDefined();
        expect((outboxEvent.payload as any).amount).toBe('990.00');
      } else {
        // If payment committed before cancellation, order status is processing and paid
        expect(finalOrder?.paymentStatus).toBe('paid');
      }
    });

    // CONC-18-D: Payment Versus Expiry Race
    it('CONC-18-D: Payment Versus Expiry — an order with verified payment cannot be expired by the background expiry worker', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '1100.00', 'pending');
      const tranId = `CONC_18_D_${Date.now()}`;
      await createTestPayment(order.id, '1100.00', tranId);

      const successPayload = {
        status: 'VALIDATED',
        amount: '1100.00',
        currency: 'BDT',
        tran_id: tranId,
      };

      // Confirm payment first
      await (paymentsService as any).handleSuccessfulPayment(
        tranId,
        successPayload,
      );

      // Now the expiry worker attempts to expire the order
      await expect(
        ordersService.expireOrder(order.id, 'Session timeout'),
      ).rejects.toThrow(/only pending orders can expire|already been paid/i);

      // Order must remain processing & paid
      const finalOrder = await ordersStore.findOrderById(order.id);
      expect(finalOrder?.status).toBe('processing');
      expect(finalOrder?.paymentStatus).toBe('paid');
    });

    // CONC-18-E: Concurrent Payment Initiation
    it('CONC-18-E: Concurrent Payment Initiation — simultaneous initiation requests for the same order prevent duplicate active payments', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '1800.00');

      // Mock gateway response for initiation
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'SUCCESS',
              GatewayPageURL: 'https://sandbox.sslcommerz.com/gw/session18',
            }),
        }),
      );

      // Fire 5 concurrent initiation requests for the same order
      const results = await Promise.allSettled(
        Array.from({ length: 5 }).map(() =>
          paymentsService.initiatePayment(
            customer.id,
            order.id,
            'http://localhost:3000',
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // At least 1 must succeed
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Count active pending payments in database for this order
      const payments = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, order.id));

      const pendingPayments = payments.filter((p) => p.status === 'pending');
      // Must not create multiple active pending payments
      expect(pendingPayments.length).toBe(1);
    });

    // CONC-18-F: Callback Versus Administrative Status Updates
    it('CONC-18-F: Callback Versus Administrative Updates — admin status change does not corrupt confirmed payment', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '2200.00', 'pending');
      const tranId = `CONC_18_F_${Date.now()}`;
      await createTestPayment(order.id, '2200.00', tranId);

      const successPayload = {
        status: 'VALIDATED',
        amount: '2200.00',
        currency: 'BDT',
        tran_id: tranId,
      };

      // Admin updates status to processing while callback arrives
      const results = await Promise.allSettled([
        ordersService.updateOrderStatus(order.id, 'processing'),
        (paymentsService as any).handleSuccessfulPayment(
          tranId,
          successPayload,
        ),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');

      const finalOrder = await ordersStore.findOrderById(order.id);
      const finalPayment =
        await paymentsStore.findPaymentByTransactionId(tranId);

      expect(finalPayment?.status).toBe('completed');
      expect(finalOrder?.paymentStatus).toBe('paid');
      expect(finalOrder?.status).toBe('processing');
    });

    // CONC-18-G: Deadlock Analysis (Zero 40P01 Deadlocks under high concurrency)
    it('CONC-18-G: Deadlock Analysis — 20 parallel interleaved order cancellations and payment callbacks execute with zero 40P01 deadlocks', async () => {
      const customer = await createTestCustomer();

      // Create 10 distinct orders with pending payments
      const orderIds: string[] = [];
      const tranIds: string[] = [];

      for (let i = 0; i < 10; i++) {
        const order = await createTestOrder(customer.id, '500.00', 'pending');
        const tranId = `CONC_18_G_${i}_${Date.now()}`;
        await createTestPayment(order.id, '500.00', tranId);
        orderIds.push(order.id);
        tranIds.push(tranId);
      }

      // Interleave 10 cancellations with 10 payment callbacks running concurrently
      const tasks: Promise<any>[] = [];
      for (let i = 0; i < 10; i++) {
        const oid = orderIds[i];
        const tid = tranIds[i];

        // Task A: Customer cancellation (locks orders then updates payments)
        tasks.push(
          ordersService
            .cancelOrder(customer.id, oid, 'Deadlock race cancellation')
            .catch((e) => ({ type: 'cancel_error', message: e.message })),
        );

        // Task B: Payment callback (locks orders then payments in canonical order)
        tasks.push(
          (paymentsService as any)
            .handleSuccessfulPayment(tid, {
              status: 'VALIDATED',
              amount: '500.00',
              currency: 'BDT',
              tran_id: tid,
            })
            .catch((e: any) => ({ type: 'payment_error', message: e.message })),
        );
      }

      const results = await Promise.all(tasks);

      // Check results for any PostgreSQL deadlock error (code 40P01 or message containing "deadlock detected")
      const deadlockErrors = results.filter(
        (r) =>
          r &&
          r.message &&
          (r.message.includes('deadlock detected') ||
            r.message.includes('40P01')),
      );

      // MUST BE ZERO DEADLOCKS
      expect(deadlockErrors.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 8: TRANSACTION FAULT INJECTION & RECONCILIATION DISCOVERABILITY
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('PHASE 8: Transaction Fault Injection & Reconciliation Discoverability', () => {
    it('FLT-18-1: Simulated DB error during order update rolls back payment status update', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '770.00');
      const tranId = `TRN_FLT_ROLLBACK_${Date.now()}`;
      await createTestPayment(order.id, '770.00', tranId);

      const originalUpdateOrderStatus =
        paymentsStore.updateOrderStatus.bind(paymentsStore);
      jest
        .spyOn(paymentsStore, 'updateOrderStatus')
        .mockImplementationOnce(async () => {
          throw new Error(
            'Simulated PostgreSQL connection drop or constraint failure',
          );
        });

      await expect(
        (paymentsService as any).handleSuccessfulPayment(tranId, {
          status: 'VALIDATED',
          amount: '770.00',
          currency: 'BDT',
          tran_id: tranId,
        }),
      ).rejects.toThrow('Simulated PostgreSQL connection drop');

      // Verify that the payment status was rolled back and is STILL pending!
      const payment = await paymentsStore.findPaymentByTransactionId(tranId);
      expect(payment?.status).toBe('pending');

      const orderInDb = await ordersStore.findOrderById(order.id);
      expect(orderInDb?.paymentStatus).toBe('unpaid');

      jest.restoreAllMocks();
    });

    it('FLT-18-2: Reconciliation item written to outbox is discoverable and recoverable by OutboxProcessor', async () => {
      const customer = await createTestCustomer();
      const order = await createTestOrder(customer.id, '1350.00', 'pending');
      const tranId = `TRN_RECON_DISC_${Date.now()}`;
      const payment = await createTestPayment(order.id, '1350.00', tranId);

      // Cancel order first
      await ordersService.cancelOrder(customer.id, order.id, 'Cancelled');

      // Payment confirms late
      await (paymentsService as any).handleSuccessfulPayment(tranId, {
        status: 'VALIDATED',
        amount: '1350.00',
        currency: 'BDT',
        tran_id: tranId,
      });

      // Verify outbox has RECONCILIATION_REQUIRED
      const [outboxEvent] = await db
        .select()
        .from(schema.outboxEvents)
        .where(
          sql`${schema.outboxEvents.type} = 'RECONCILIATION_REQUIRED' AND ${schema.outboxEvents.payload}->>'orderId' = ${order.id}`,
        );

      expect(outboxEvent).toBeDefined();
      expect(outboxEvent.status).toBe('pending');
      expect((outboxEvent.payload as any).amount).toBe('1350.00');
      expect((outboxEvent.payload as any).transactionId).toBe(tranId);
    });
  });
});

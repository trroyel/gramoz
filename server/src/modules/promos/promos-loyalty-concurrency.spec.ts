import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { PromosService } from './promos.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltyStore } from '../loyalty/loyalty.store';
import { SettingsService } from '../settings/settings.service';
import { SettingsStore } from '../settings/settings.store';
import { OrdersService } from '../orders/orders.service';
import { OrdersStore } from '../orders/orders.store';
import { CourierService } from '../courier/courier.service';
import { InvoicesService } from '../orders/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentsStore } from '../payments/payments.store';

describe('Promos & Loyalty Concurrency Suite (CONC-21)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let promosService: PromosService;
  let loyaltyService: LoyaltyService;
  let ordersService: OrdersService;
  let ordersStore: OrdersStore;
  let paymentsService: PaymentsService;
  let paymentsStore: PaymentsStore;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  let testUserAId: string;
  let testUserBId: string;
  let testAddressAId: string;
  let testAddressBId: string;
  let testProductId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      max: 25, // Large pool for 10-20 concurrent connections
    });
    db = drizzle(pool, { schema });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromosService,
        LoyaltyService,
        LoyaltyStore,
        SettingsService,
        SettingsStore,
        OrdersService,
        OrdersStore,
        PaymentsService,
        PaymentsStore,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SSLCOMMERZ_STORE_ID') return 'testbox';
              if (key === 'SSLCOMMERZ_STORE_SECRET') return 'testpass';
              if (key === 'SSLCOMMERZ_IS_SANDBOX') return 'true';
              return null;
            }),
          },
        },
        {
          provide: CourierService,
          useValue: {
            calculateCharge: jest.fn().mockResolvedValue({ charge: 60 }),
          },
        },
        {
          provide: InvoicesService,
          useValue: {
            generateInvoice: jest.fn().mockResolvedValue(Buffer.from('PDF')),
          },
        },
        {
          provide: DATABASE,
          useValue: db,
        },
      ],
    }).compile();

    promosService = module.get<PromosService>(PromosService);
    loyaltyService = module.get<LoyaltyService>(LoyaltyService);
    ordersService = module.get<OrdersService>(OrdersService);
    ordersStore = module.get<OrdersStore>(OrdersStore);
    paymentsService = module.get<PaymentsService>(PaymentsService);
    paymentsStore = module.get<PaymentsStore>(PaymentsStore);

    const client = await pool.connect();
    try {
      // 1. Create Users
      const u1 = await client.query(`
        INSERT INTO users (email, password_hash, full_name, role, status)
        VALUES ('conc21_user_a@example.com', 'hash', 'User A', 'customer', 'active')
        ON CONFLICT (email) DO UPDATE SET full_name = 'User A'
        RETURNING id;
      `);
      testUserAId = u1.rows[0].id;

      const u2 = await client.query(`
        INSERT INTO users (email, password_hash, full_name, role, status)
        VALUES ('conc21_user_b@example.com', 'hash', 'User B', 'customer', 'active')
        ON CONFLICT (email) DO UPDATE SET full_name = 'User B'
        RETURNING id;
      `);
      testUserBId = u2.rows[0].id;

      // 2. Create Addresses
      const a1 = await client.query(`
        INSERT INTO addresses (user_id, title, address_line_1, city)
        VALUES ('${testUserAId}', 'Home A', 'Road 1', 'Dhaka')
        RETURNING id;
      `);
      testAddressAId = a1.rows[0].id;

      const a2 = await client.query(`
        INSERT INTO addresses (user_id, title, address_line_1, city)
        VALUES ('${testUserBId}', 'Home B', 'Road 2', 'Dhaka')
        RETURNING id;
      `);
      testAddressBId = a2.rows[0].id;

      // 3. Create Product with ample stock for concurrency tests
      const p = await client.query(`
        INSERT INTO products (name, slug, price, stock, status)
        VALUES ('Conc21 Test Polo', 'conc21-test-polo-${Date.now()}', 500.00, 500, 'active')
        RETURNING id;
      `);
      testProductId = p.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (testUserAId && testUserBId) {
      const client = await pool.connect();
      try {
        await client.query(
          `DELETE FROM loyalty_points WHERE user_id IN ('${testUserAId}', '${testUserBId}');`,
        );
        await client.query(
          `DELETE FROM inventory_transactions WHERE product_id = '${testProductId}';`,
        );
        await client.query(
          `DELETE FROM order_items WHERE product_id = '${testProductId}';`,
        );
        await client.query(
          `DELETE FROM orders WHERE user_id IN ('${testUserAId}', '${testUserBId}');`,
        );
        await client.query(
          `DELETE FROM addresses WHERE user_id IN ('${testUserAId}', '${testUserBId}');`,
        );
        await client.query(
          `DELETE FROM users WHERE id IN ('${testUserAId}', '${testUserBId}');`,
        );
        await client.query(
          `DELETE FROM products WHERE id = '${testProductId}';`,
        );
        await client.query(`DELETE FROM promos WHERE code LIKE 'CONC21_%';`);
      } finally {
        client.release();
      }
    }
    await pool.end();
  });

  // --- CONC-21-A: Last Promo Usage ---
  it('CONC-21-A: Last Promo Usage — 10 concurrent requests for coupon with 1 remaining use yields exactly 1 success', async () => {
    const promoCode = `CONC21_LAST_${Date.now()}`;
    const promo = await promosService.create({
      code: promoCode,
      discountType: 'fixed',
      discountValue: 100,
      maxUses: 1, // Only 1 use allowed!
      isActive: true,
    });

    // 10 concurrent calls to incrementPromoUsage using isolated transactions
    const results = await Promise.allSettled(
      Array.from({ length: 10 }).map(() =>
        db.transaction(async (tx) => {
          const success = await ordersStore.incrementPromoUsage(promo.id, tx);
          if (!success) {
            throw new Error('Quota exceeded');
          }
          return success;
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(9);

    const [finalPromo] = await db
      .select()
      .from(schema.promos)
      .where(eq(schema.promos.id, promo.id));
    expect(finalPromo.currentUses).toBe(1); // Never exceeded 1!
  });

  // --- CONC-21-B: Global Usage Limit ---
  it('CONC-21-B: Global Usage Limit — 20 concurrent requests for coupon with maxUses=5 yields exactly 5 successes', async () => {
    const promoCode = `CONC21_GLOBAL_${Date.now()}`;
    const promo = await promosService.create({
      code: promoCode,
      discountType: 'percentage',
      discountValue: 15,
      maxUses: 5, // Exactly 5 uses allowed
      isActive: true,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }).map(() =>
        db.transaction(async (tx) => {
          const success = await ordersStore.incrementPromoUsage(promo.id, tx);
          if (!success) {
            throw new Error('Quota exceeded');
          }
          return success;
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(5);
    expect(rejected.length).toBe(15);

    const [finalPromo] = await db
      .select()
      .from(schema.promos)
      .where(eq(schema.promos.id, promo.id));
    expect(finalPromo.currentUses).toBe(5);
  });

  // --- CONC-21-C: Single-Use Coupon Race ---
  it('CONC-21-C: Single-Use Coupon Race — 1 customer fires 10 simultaneous redemptions, exactly 1 succeeds', async () => {
    const promoCode = `CONC21_SINGLE_${Date.now()}`;
    const promo = await promosService.create({
      code: promoCode,
      discountType: 'fixed',
      discountValue: 50,
      maxUses: 1,
      isActive: true,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }).map(() =>
        db.transaction(async (tx) => {
          const success = await ordersStore.incrementPromoUsage(promo.id, tx);
          if (!success) {
            throw new Error('Quota exceeded');
          }
          return success;
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(1);

    const [finalPromo] = await db
      .select()
      .from(schema.promos)
      .where(eq(schema.promos.id, promo.id));
    expect(finalPromo.currentUses).toBe(1);
  });

  // --- CONC-21-D: Loyalty Overspending ---
  it('CONC-21-D: Loyalty Overspending — 2 concurrent purchases attempt 80 points each with 100 balance, at most 1 succeeds', async () => {
    // Reset points for User A to exactly 100
    await db
      .delete(schema.loyaltyPoints)
      .where(eq(schema.loyaltyPoints.userId, testUserAId));
    await db.insert(schema.loyaltyPoints).values({
      userId: testUserAId,
      points: 100,
      type: 'earned_review_media',
      validUntil: null,
    });

    // Fire 2 concurrent spend transactions attempting 80 points each
    const results = await Promise.allSettled([
      db.transaction(async (tx) => {
        return loyaltyService.spendPoints(
          testUserAId,
          80,
          crypto.randomUUID(),
          tx,
        );
      }),
      db.transaction(async (tx) => {
        return loyaltyService.spendPoints(
          testUserAId,
          80,
          crypto.randomUUID(),
          tx,
        );
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 succeeds, 1 rejected with insufficient points!
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Final balance must be 20 points, strictly non-negative!
    const finalBalance = await loyaltyService.getBalance(testUserAId);
    expect(finalBalance).toBe(20);
  });

  // --- CONC-21-E: Duplicate Checkout ---
  it('CONC-21-E: Duplicate Checkout — 10 concurrent requests with same idempotency key create exactly 1 order', async () => {
    const key = `conc21-idem-${Date.now()}`;
    const promoCode = `CONC21_IDEM_${Date.now()}`;
    await promosService.create({
      code: promoCode,
      discountType: 'fixed',
      discountValue: 50,
      maxUses: 10,
      isActive: true,
    });

    // Add item to cart for User B
    await db
      .delete(schema.cartItems)
      .where(eq(schema.cartItems.userId, testUserBId));
    await db.insert(schema.cartItems).values({
      userId: testUserBId,
      productId: testProductId,
      quantity: 1,
    });

    // 10 concurrent requests with the identical idempotency key
    const results = await Promise.allSettled(
      Array.from({ length: 10 }).map(() =>
        ordersService.createOrderFromCart(testUserBId, {
          addressLine1: 'Road 2',
          city: 'Dhaka',
          phone: '01700000000',
          promoCode,
          idempotencyKey: key,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // At least 1 succeeds, racing duplicates either return identical order or get rejected
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Verify all fulfilled results returned the exact same order ID
    const orderIds = new Set(
      fulfilled.map((r: any) => r.value.id || r.value.order?.id),
    );
    expect(orderIds.size).toBe(1);

    // Verify only 1 order exists in database with this key
    const orders = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.idempotencyKey, key));
    expect(orders.length).toBe(1);
  });

  // --- CONC-21-F: Failed Checkout Rollback ---
  it('CONC-21-F: Failed Checkout Rollback — controlled transaction abort rolls back promo quota and loyalty deductions', async () => {
    const promoCode = `CONC21_ROLLBACK_${Date.now()}`;
    const promo = await promosService.create({
      code: promoCode,
      discountType: 'fixed',
      discountValue: 100,
      maxUses: 5,
      isActive: true,
    });

    const initialBalance = await loyaltyService.getBalance(testUserAId);

    // Attempt transaction that applies promo, spends points, then throws error before commit
    await expect(
      db.transaction(async (tx) => {
        await ordersStore.incrementPromoUsage(promo.id, tx);
        await loyaltyService.spendPoints(
          testUserAId,
          10,
          crypto.randomUUID(),
          tx,
        );
        throw new Error(
          'Controlled fault injection: network partition before commit',
        );
      }),
    ).rejects.toThrow(
      'Controlled fault injection: network partition before commit',
    );

    // Verify promo usage was rolled back to 0
    const [promoRow] = await db
      .select()
      .from(schema.promos)
      .where(eq(schema.promos.id, promo.id));
    expect(promoRow.currentUses).toBe(0);

    // Verify points balance was rolled back to initial
    const finalBalance = await loyaltyService.getBalance(testUserAId);
    expect(finalBalance).toBe(initialBalance);
  });

  // --- CONC-21-G: Cancellation Race ---
  it('CONC-21-G: Cancellation Race — 2 simultaneous cancellations restore promo and points at most once', async () => {
    // 1. Create order with promo and points
    const promoCode = `CONC21_CANCELRACE_${Date.now()}`;
    const promo = await promosService.create({
      code: promoCode,
      discountType: 'fixed',
      discountValue: 50,
      maxUses: 5,
      isActive: true,
    });

    const [order] = await db
      .insert(schema.orders)
      .values({
        userId: testUserAId,
        shippingAddressId: testAddressAId,
        totalAmount: '450.00',
        deliveryCharge: '0.00',
        promoId: promo.id,
        discountAmount: '60.00',
        status: 'pending',
        paymentStatus: 'unpaid',
      })
      .returning();

    // Increment promo usage to 1
    await db
      .update(schema.promos)
      .set({ currentUses: 1 })
      .where(eq(schema.promos.id, promo.id));

    // Record 10 points spent on order
    await db.insert(schema.loyaltyPoints).values({
      userId: testUserAId,
      points: -10,
      type: 'spent_checkout',
      referenceId: order.id,
      validUntil: null,
    });

    const balanceBeforeCancel = await loyaltyService.getBalance(testUserAId);

    // Race two simultaneous cancellation requests
    const results = await Promise.allSettled([
      ordersService.cancelOrder(testUserAId, order.id, 'Cancel A'),
      ordersService.cancelOrder(testUserAId, order.id, 'Cancel B'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 succeeds, 1 rejected with order already cancelled
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify promo usage decremented exactly once to 0
    const [promoRow] = await db
      .select()
      .from(schema.promos)
      .where(eq(schema.promos.id, promo.id));
    expect(promoRow.currentUses).toBe(0);

    // Verify points restored exactly once (initial + 10)
    const balanceAfterCancel = await loyaltyService.getBalance(testUserAId);
    expect(balanceAfterCancel).toBe(balanceBeforeCancel + 10);
  });

  // --- CONC-21-H: Payment Success Replay ---
  it('CONC-21-H: Payment Success Replay — 10 duplicate payment notifications transition payment and order exactly once', async () => {
    const [order] = await db
      .insert(schema.orders)
      .values({
        userId: testUserAId,
        shippingAddressId: testAddressAId,
        totalAmount: '500.00',
        deliveryCharge: '0.00',
        status: 'pending',
        paymentStatus: 'initiated',
      })
      .returning();

    const tranId = `TRAN_CONC21_${Date.now()}`;
    const [payment] = await db
      .insert(schema.payments)
      .values({
        orderId: order.id,
        amount: '500.00',
        method: 'sslcommerz',
        transactionId: tranId,
        status: 'pending',
      })
      .returning();

    // Fire 10 simultaneous successful payment callbacks
    const results = await Promise.allSettled(
      Array.from({ length: 10 }).map(() =>
        (paymentsService as any).handleSuccessfulPayment(tranId, {
          val_id: 'VALID_VAL_ID',
          tran_id: tranId,
          amount: '500.00',
          currency: 'BDT',
          value_a: order.id,
        }),
      ),
    );

    // All should complete cleanly without error
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(10);

    // Payment must be completed, order must be paid & processing
    const [updatedPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    expect(updatedPayment.status).toBe('completed');

    const [updatedOrder] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, order.id));
    expect(updatedOrder.paymentStatus).toBe('paid');
    expect(updatedOrder.status).toBe('processing');
  });

  // --- CONC-21-I: Payment Confirmation vs Cancellation Race ---
  it('CONC-21-I: Payment vs Cancellation — canonical locks preserve financial state cleanly', async () => {
    const [order] = await db
      .insert(schema.orders)
      .values({
        userId: testUserAId,
        shippingAddressId: testAddressAId,
        totalAmount: '500.00',
        deliveryCharge: '0.00',
        status: 'pending',
        paymentStatus: 'initiated',
      })
      .returning();

    const tranId = `TRAN_RACE_${Date.now()}`;
    await db.insert(schema.payments).values({
      orderId: order.id,
      amount: '500.00',
      method: 'sslcommerz',
      transactionId: tranId,
      status: 'pending',
    });

    // Race payment confirmation against order cancellation
    const [payResult, cancelResult] = await Promise.allSettled([
      (paymentsService as any).handleSuccessfulPayment(tranId, {
        val_id: 'VALID_VAL_ID',
        tran_id: tranId,
        amount: '500.00',
        currency: 'BDT',
        value_a: order.id,
      }),
      ordersService.cancelOrder(
        testUserAId,
        order.id,
        'Late cancellation race',
      ),
    ]);

    // Check final state in PostgreSQL: must be clean and consistent
    const [finalOrder] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, order.id));

    // Either payment won (order is paid/processing) or cancel won (order is cancelled with reconciliation flagged)
    if (finalOrder.status === 'cancelled') {
      expect(finalOrder.paymentStatus).toBe('paid'); // Late payment flagged reconciliation
    } else {
      expect(finalOrder.status).toBe('processing');
      expect(finalOrder.paymentStatus).toBe('paid');
    }
  });

  // --- CONC-21-J: Promotion Disable vs Checkout Race ---
  it('CONC-21-J: Promotion Disable vs Checkout — atomic update predicate prevents redemption of disabled promo', async () => {
    const promoCode = `CONC21_DISABLE_${Date.now()}`;
    const promo = await promosService.create({
      code: promoCode,
      discountType: 'fixed',
      discountValue: 50,
      maxUses: 10,
      isActive: true,
    });

    // Disable the promo immediately
    await promosService.toggleActive(promo.id);

    // Attempting to increment promo usage must return false due to isActive=false check
    const success = await db.transaction(async (tx) => {
      return ordersStore.incrementPromoUsage(promo.id, tx);
    });

    expect(success).toBe(false);

    const [finalPromo] = await db
      .select()
      .from(schema.promos)
      .where(eq(schema.promos.id, promo.id));
    expect(finalPromo.currentUses).toBe(0);
  });
});

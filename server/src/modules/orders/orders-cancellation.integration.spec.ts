/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@database/schema';
import { OrdersStore } from './orders.store';
import { OrdersService } from './orders.service';
import { OrdersExpiryProcessor } from './orders-expiry.processor';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltyStore } from '../loyalty/loyalty.store';
import { SettingsService } from '../settings/settings.service';
import { SettingsStore } from '../settings/settings.store';
import { PromosService } from '../promos/promos.service';
import { CourierService } from '../courier/courier.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentsStore } from '../payments/payments.store';
import {
  InvalidOperationError,
  ForbiddenOperationError,
} from '../../common/errors/domain.errors';

describe('Orders Cancellation & Inventory Restock (Integration & Concurrency — TASK-03)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let ordersStore: OrdersStore;
  let ordersService: OrdersService;
  let loyaltyStore: LoyaltyStore;
  let loyaltyService: LoyaltyService;
  let settingsStore: SettingsStore;
  let settingsService: SettingsService;
  let paymentsStore: PaymentsStore;
  let paymentsService: PaymentsService;
  let expiryProcessor: OrdersExpiryProcessor;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  // Test entities
  let testUserId: string;
  let testOtherUserId: string;
  let testAddressId: string;
  let testProductId: string;
  let testVariantId: string;
  let testPromoId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 10,
    });
    db = drizzle(pool, { schema });

    // Initialize stores and services
    ordersStore = new OrdersStore(db as any);
    loyaltyStore = new LoyaltyStore(db as any);
    settingsStore = new SettingsStore(db as any);
    paymentsStore = new PaymentsStore(db as any);

    settingsService = new SettingsService(settingsStore);
    loyaltyService = new LoyaltyService(loyaltyStore, settingsService);
    const mockPromosService = {
      validate: jest.fn(),
    } as unknown as PromosService;
    const mockCourierService = {
      calculateCharge: jest.fn().mockResolvedValue({ charge: 60 }),
      createConsignment: jest
        .fn()
        .mockResolvedValue({ tracking_code: 'TRK01' }),
    } as unknown as CourierService;

    ordersService = new OrdersService(
      ordersStore,
      mockPromosService,
      loyaltyService,
      settingsService,
      mockCourierService,
    );

    const mockConfig = {
      get: (key: string, defaultVal?: unknown) => {
        const values: Record<string, unknown> = {
          SSLCOMMERZ_STORE_ID: 'test-store',
          SSLCOMMERZ_STORE_SECRET: 'test-secret',
          SSLCOMMERZ_IS_SANDBOX: 'true',
        };
        return values[key] ?? defaultVal;
      },
    } as any;

    paymentsService = new PaymentsService(mockConfig, paymentsStore);

    expiryProcessor = new OrdersExpiryProcessor(
      ordersStore,
      ordersService,
      settingsService,
    );

    // Setup base fixture rows in real PostgreSQL
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `cancellation_user_${Date.now()}@example.com`,
        passwordHash: '$2b$10$insecureplaceholderfortests',
        fullName: 'Cancellation Customer',
        phone: '01711223344',
        isPhoneVerified: true,
        role: 'customer',
      })
      .returning();
    testUserId = user.id;

    const [otherUser] = await db
      .insert(schema.users)
      .values({
        email: `other_user_${Date.now()}@example.com`,
        passwordHash: '$2b$10$insecureplaceholderfortests',
        fullName: 'Other Customer',
        phone: '01799887766',
        isPhoneVerified: true,
        role: 'customer',
      })
      .returning();
    testOtherUserId = otherUser.id;

    const [address] = await db
      .insert(schema.addresses)
      .values({
        userId: testUserId,
        title: 'Home',
        addressLine1: '123 Test Avenue',
        city: 'Dhaka',
      })
      .returning();
    testAddressId = address.id;

    const [category] = await db
      .insert(schema.categories)
      .values({
        name: `Test Cat ${Date.now()}`,
        slug: `test-cat-${Date.now()}`,
      })
      .returning();

    const [product] = await db
      .insert(schema.products)
      .values({
        name: 'Atomic Restock Product',
        slug: `restock-prod-${Date.now()}`,
        price: '100.00',
        stock: 50, // Starting stock
        categoryId: category.id,
      })
      .returning();
    testProductId = product.id;

    const [variant] = await db
      .insert(schema.productVariants)
      .values({
        productId: testProductId,
        sku: `SKU-VAR-${Date.now()}`,
        price: '120.00',
        stock: 25, // Starting variant stock
        attributes: { size: 'L' },
      })
      .returning();
    testVariantId = variant.id;

    const [promo] = await db
      .insert(schema.promos)
      .values({
        code: `PROMO_${Date.now()}`,
        discountType: 'fixed',
        discountValue: '20.00',
        maxUses: 10,
        currentUses: 5,
        isActive: true,
      })
      .returning();
    testPromoId = promo.id;
  });

  afterAll(async () => {
    // Clean up test data
    try {
      if (testUserId) {
        await pool.query(
          'DELETE FROM orders WHERE user_id = $1 OR user_id = $2',
          [testUserId, testOtherUserId],
        );
        await pool.query('DELETE FROM addresses WHERE user_id = $1', [
          testUserId,
        ]);
        await pool.query('DELETE FROM loyalty_points WHERE user_id = $1', [
          testUserId,
        ]);
        await pool.query('DELETE FROM users WHERE id = $1 OR id = $2', [
          testUserId,
          testOtherUserId,
        ]);
      }
      if (testProductId) {
        await pool.query('DELETE FROM product_variants WHERE id = $1', [
          testVariantId,
        ]);
        await pool.query(
          'DELETE FROM inventory_transactions WHERE product_id = $1',
          [testProductId],
        );
        await pool.query('DELETE FROM products WHERE id = $1', [testProductId]);
      }
      if (testPromoId) {
        await pool.query('DELETE FROM promos WHERE id = $1', [testPromoId]);
      }
    } finally {
      await pool.end().catch(() => {});
    }
  });

  // Helper to create an order with deducted stock in PostgreSQL
  async function createOrderFixture(params: {
    status?: schema.Order['status'];
    paymentStatus?: schema.Order['paymentStatus'];
    createdAt?: Date;
    promoId?: string;
    productQty?: number;
    variantQty?: number;
    userId?: string;
  }) {
    const userId = params.userId || testUserId;
    const productQty = params.productQty ?? 2;
    const variantQty = params.variantQty ?? 3;

    // Deduct stock in DB to represent prior checkout
    await db
      .update(schema.products)
      .set({ stock: sql`stock - ${productQty}` })
      .where(eq(schema.products.id, testProductId));

    await db
      .update(schema.productVariants)
      .set({ stock: sql`stock - ${variantQty}` })
      .where(eq(schema.productVariants.id, testVariantId));

    const [order] = await db
      .insert(schema.orders)
      .values({
        userId,
        shippingAddressId: testAddressId,
        totalAmount: '500.00',
        status: params.status || 'pending',
        paymentStatus: params.paymentStatus || 'unpaid',
        promoId: params.promoId || null,
        createdAt: params.createdAt || new Date(),
      })
      .returning();

    // Insert order items
    await db.insert(schema.orderItems).values([
      {
        orderId: order.id,
        productId: testProductId,
        variantId: null,
        quantity: productQty,
        unitPrice: '100.00',
      },
      {
        orderId: order.id,
        productId: testProductId,
        variantId: testVariantId,
        quantity: variantQty,
        unitPrice: '120.00',
      },
    ]);

    return { orderId: order.id, productQty, variantQty };
  }

  // Helper to get fresh stock numbers from database
  async function getCurrentStock() {
    const [p] = await db
      .select({ stock: schema.products.stock })
      .from(schema.products)
      .where(eq(schema.products.id, testProductId));
    const [v] = await db
      .select({ stock: schema.productVariants.stock })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, testVariantId));
    return { productStock: p.stock, variantStock: v.stock };
  }

  describe('Scenario 1: Atomic Transaction Commit & Stock Restoration', () => {
    it('restores both product and variant inventory and logs audit trail in PostgreSQL', async () => {
      const initialStock = await getCurrentStock();

      const { orderId, productQty, variantQty } = await createOrderFixture({
        productQty: 2,
        variantQty: 3,
      });

      // Stock was reduced by 2 and 3
      const stockAfterOrder = await getCurrentStock();
      expect(stockAfterOrder.productStock).toBe(
        initialStock.productStock - productQty,
      );
      expect(stockAfterOrder.variantStock).toBe(
        initialStock.variantStock - variantQty,
      );

      // Execute order cancellation
      const cancelled = await ordersService.cancelOrder(
        testUserId,
        orderId,
        'Customer changed mind',
      );
      expect(cancelled.status).toBe('cancelled');

      // Verify stock in database is exactly restored
      const finalStock = await getCurrentStock();
      expect(finalStock.productStock).toBe(initialStock.productStock);
      expect(finalStock.variantStock).toBe(initialStock.variantStock);

      // Verify inventory transactions audit records in PostgreSQL
      const auditRecords = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.referenceId, orderId));

      expect(auditRecords.length).toBe(2);
      expect(auditRecords.every((r) => r.type === 'in')).toBe(true);
      expect(auditRecords.find((r) => r.quantity === productQty)).toBeDefined();
      expect(auditRecords.find((r) => r.quantity === variantQty)).toBeDefined();
    });
  });

  describe('Scenario 2: Atomic Rollback on Mid-Transaction Failure', () => {
    it('rolls back completely if a mid-transaction error is encountered', async () => {
      const { orderId } = await createOrderFixture({
        productQty: 1,
        variantQty: 1,
      });
      const stockBeforeCancellation = await getCurrentStock();

      // Spy on createInventoryTransaction to simulate unexpected DB failure mid-transaction
      const errorSpy = jest
        .spyOn(ordersStore, 'createInventoryTransaction')
        .mockRejectedValueOnce(
          new Error('Simulated disk full or DB constraint error'),
        );

      try {
        await expect(
          ordersService.cancelOrder(testUserId, orderId, 'Failing cancel'),
        ).rejects.toThrow('Simulated disk full or DB constraint error');

        // Order status must NOT be cancelled (rolled back)
        const orderInDb = await ordersStore.findOrderById(orderId);
        expect(orderInDb?.status).toBe('pending');

        // Stock must remain untouched (rolled back)
        const stockAfterRollback = await getCurrentStock();
        expect(stockAfterRollback.productStock).toBe(
          stockBeforeCancellation.productStock,
        );
        expect(stockAfterRollback.variantStock).toBe(
          stockBeforeCancellation.variantStock,
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('Scenario 3: Concurrent Cancellation & Exactly-Once Restocking', () => {
    it('guarantees exactly-once inventory restocking under 5 concurrent cancellation requests', async () => {
      const initialStock = await getCurrentStock();
      const productQty = 2;
      const variantQty = 4;

      const { orderId } = await createOrderFixture({
        productQty,
        variantQty,
      });

      // Fire 5 concurrent cancellation requests simultaneously
      const cancellationPromises = Array.from({ length: 5 }, () =>
        ordersService.cancelOrder(
          testUserId,
          orderId,
          'Concurrent cancellation attempt',
        ),
      );

      const results = await Promise.allSettled(cancellationPromises);

      // Exactly ONE request must succeed
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);

      // Rejected errors must state order is already cancelled or status changed
      rejected.forEach((r: any) => {
        expect(r.reason.message).toMatch(
          /already cancelled|could not be cancelled/i,
        );
      });

      // Stock must be incremented EXACTLY ONCE (not 5 times!)
      const finalStock = await getCurrentStock();
      expect(finalStock.productStock).toBe(initialStock.productStock);
      expect(finalStock.variantStock).toBe(initialStock.variantStock);

      // Exactly 2 audit records must exist (1 product, 1 variant)
      const auditRecords = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.referenceId, orderId));
      expect(auditRecords.length).toBe(2);
    });
  });

  describe('Scenario 4: Promo Quota and Loyalty Points Restoration', () => {
    it('decrements promo usage quota and restores spent loyalty points in database', async () => {
      // Seed initial positive balance for testUser
      await loyaltyStore.createTransaction({
        userId: testUserId,
        points: 100,
        type: 'earned_review_media',
        referenceId: null,
        validUntil: null,
      });

      // Record 30 loyalty points spent on checkout
      await loyaltyStore.createTransaction({
        userId: testUserId,
        points: -30,
        type: 'spent_checkout',
        referenceId: null, // will link below
        validUntil: null,
      });
      const balanceBeforeOrder =
        await loyaltyStore.getAvailableBalance(testUserId);

      // Fetch promo current uses
      const [promoBefore] = await db
        .select({ currentUses: schema.promos.currentUses })
        .from(schema.promos)
        .where(eq(schema.promos.id, testPromoId));

      const { orderId } = await createOrderFixture({
        promoId: testPromoId,
        productQty: 1,
        variantQty: 1,
      });

      // Link loyalty transaction to this orderId
      await db
        .update(schema.loyaltyPoints)
        .set({ referenceId: orderId })
        .where(
          sql`user_id = ${testUserId} AND type = 'spent_checkout' AND reference_id IS NULL`,
        );

      // Cancel the order
      await ordersService.cancelOrder(testUserId, orderId);

      // Verify promo usage was decremented by 1
      const [promoAfter] = await db
        .select({ currentUses: schema.promos.currentUses })
        .from(schema.promos)
        .where(eq(schema.promos.id, testPromoId));
      expect(promoAfter.currentUses).toBe(promoBefore.currentUses - 1);

      // Verify loyalty balance was restored by +30 points
      const balanceAfterCancel =
        await loyaltyStore.getAvailableBalance(testUserId);
      expect(balanceAfterCancel).toBe(balanceBeforeOrder + 30);

      // Verify duplicate cancellation attempt does not re-refund loyalty points
      await expect(
        ordersService.cancelOrder(testUserId, orderId),
      ).rejects.toThrow(InvalidOperationError);

      const balanceAfterDuplicate =
        await loyaltyStore.getAvailableBalance(testUserId);
      expect(balanceAfterDuplicate).toBe(balanceAfterCancel);
    });
  });

  describe('Scenario 5: State Machine & Authorization Guards', () => {
    it('rejects unauthorized cancellation attempt by another user', async () => {
      const { orderId } = await createOrderFixture({ userId: testUserId });

      await expect(
        ordersService.cancelOrder(testOtherUserId, orderId),
      ).rejects.toThrow(ForbiddenOperationError);
    });

    it('rejects cancellation on delivered orders', async () => {
      const { orderId } = await createOrderFixture({ status: 'delivered' });

      await expect(
        ordersService.cancelOrder(testUserId, orderId),
      ).rejects.toThrow(InvalidOperationError);

      await expect(
        ordersService.updateOrderStatus(orderId, 'cancelled'),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('rejects invalid state transitions (pending -> delivered)', async () => {
      const { orderId } = await createOrderFixture({ status: 'pending' });

      await expect(
        ordersService.updateOrderStatus(orderId, 'delivered'),
      ).rejects.toThrow(InvalidOperationError);
    });
  });

  describe('Scenario 6: Stale Checkout Expiry & COD Immunity', () => {
    it('expires stale online orders while strictly preserving Cash On Delivery (COD) orders', async () => {
      const staleTimestamp = new Date(Date.now() - 40 * 60 * 1000); // 40 minutes ago

      // Order A: Stale online checkout (>40m old, unpaid, no COD) -> SHOULD EXPIRE
      const { orderId: orderA } = await createOrderFixture({
        createdAt: staleTimestamp,
        status: 'pending',
        paymentStatus: 'unpaid',
      });

      // Order B: Stale order with COD payment -> MUST NEVER EXPIRE
      const { orderId: orderB } = await createOrderFixture({
        createdAt: staleTimestamp,
        status: 'pending',
        paymentStatus: 'unpaid',
      });
      await db.insert(schema.payments).values({
        orderId: orderB,
        amount: '500.00',
        method: 'COD',
        status: 'pending',
      });

      // Order C: Stale order with completed payment -> MUST NEVER EXPIRE
      const { orderId: orderC } = await createOrderFixture({
        createdAt: staleTimestamp,
        status: 'pending',
        paymentStatus: 'paid',
      });

      // Order D: Recent online checkout (5 mins ago) -> MUST NOT EXPIRE YET
      const { orderId: orderD } = await createOrderFixture({
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        status: 'pending',
        paymentStatus: 'unpaid',
      });

      // Execute expiry worker
      const expiredCount = await expiryProcessor.processStaleCheckoutExpiry();

      expect(expiredCount).toBeGreaterThanOrEqual(1);

      // Verify Order A is cancelled and restocked
      const dbOrderA = await ordersStore.findOrderById(orderA);
      expect(dbOrderA?.status).toBe('cancelled');

      // Verify Order B (COD) is still pending! (COD immunity)
      const dbOrderB = await ordersStore.findOrderById(orderB);
      expect(dbOrderB?.status).toBe('pending');

      // Verify Order C (Paid) is still pending/paid!
      const dbOrderC = await ordersStore.findOrderById(orderC);
      expect(dbOrderC?.status).toBe('pending');
      expect(dbOrderC?.paymentStatus).toBe('paid');

      // Verify Order D (Recent) is still pending!
      const dbOrderD = await ordersStore.findOrderById(orderD);
      expect(dbOrderD?.status).toBe('pending');
    });
  });

  describe('Scenario 7: Payment Race vs Expiry Serialization', () => {
    it('does not revive a cancelled order to processing when payment webhook arrives after cancellation', async () => {
      const { orderId } = await createOrderFixture({
        status: 'pending',
        paymentStatus: 'initiated',
      });

      const tranId = `RACE_TRN_${Date.now()}`;
      await db.insert(schema.payments).values({
        orderId,
        amount: '500.00',
        method: 'SSLCommerz',
        transactionId: tranId,
        status: 'pending',
      });

      // Step 1: Cancellation/expiry executes first
      await ordersService.cancelOrder(
        testUserId,
        orderId,
        'Expired before payment confirmed',
      );

      const orderAfterCancel = await ordersStore.findOrderById(orderId);
      expect(orderAfterCancel?.status).toBe('cancelled');

      // Step 2: Delayed payment webhook arrives and succeeds
      // Mock gateway validation response
      global.fetch = jest.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'VALIDATED', amount: '500.00' }),
      } as any);

      // Invoke internal handler to verify race behavior
      await (paymentsService as any).handleSuccessfulPayment(tranId, {
        amount: '500.00',
        status: 'VALIDATED',
      });

      // Verify payment was marked completed for accounting
      const updatedPayment =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(updatedPayment?.status).toBe('completed');

      // CRITICAL: Order status MUST REMAIN cancelled! It must NOT be resurrected to processing!
      const finalOrder = await ordersStore.findOrderById(orderId);
      expect(finalOrder?.status).toBe('cancelled');
      expect(finalOrder?.paymentStatus).toBe('paid'); // Recorded for manual customer refund
    });
  });
});

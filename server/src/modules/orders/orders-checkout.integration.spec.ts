/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@database/schema';
import { OrdersStore } from './orders.store';
import { OrdersService, ORDER_STATE_TRANSITIONS } from './orders.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltyStore } from '../loyalty/loyalty.store';
import { SettingsService } from '../settings/settings.service';
import { SettingsStore } from '../settings/settings.store';
import { PromosService } from '../promos/promos.service';
import { CourierService } from '../courier/courier.service';
import {
  InvalidOperationError,
  InsufficientStockError,
} from '../../common/errors/domain.errors';

describe('Orders Checkout Concurrency, Idempotency & State Machine (PostgreSQL Integration — TASK-08)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let ordersStore: OrdersStore;
  let ordersService: OrdersService;
  let loyaltyStore: LoyaltyStore;
  let loyaltyService: LoyaltyService;
  let settingsStore: SettingsStore;
  let settingsService: SettingsService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  // Seeded test entities
  const createdUserIds: string[] = [];
  let testCategoryId: string;
  let testProductId: string;
  let testVariantId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 20,
    });
    db = drizzle(pool, { schema });

    ordersStore = new OrdersStore(db as any);
    loyaltyStore = new LoyaltyStore(db as any);
    settingsStore = new SettingsStore(db as any);

    settingsService = new SettingsService(settingsStore);
    loyaltyService = new LoyaltyService(loyaltyStore, settingsService);
    const mockPromosService = {
      validate: jest
        .fn()
        .mockResolvedValue({ promoId: null, discountAmount: 0 }),
    } as unknown as PromosService;
    const mockCourierService = {
      calculateCharge: jest
        .fn()
        .mockResolvedValue({ charge: 60, estimatedDays: '2-3' }),
      createConsignment: jest
        .fn()
        .mockResolvedValue({ tracking_code: 'TRK-INT' }),
    } as unknown as CourierService;

    ordersService = new OrdersService(
      ordersStore,
      mockPromosService,
      loyaltyService,
      settingsService,
      mockCourierService,
    );

    // Seed shared category, product, and variant
    const [cat] = await db
      .insert(schema.categories)
      .values({
        name: `Checkout Cat ${Date.now()}`,
        slug: `checkout-cat-${Date.now()}`,
      })
      .returning();
    testCategoryId = cat.id;

    const [prod] = await db
      .insert(schema.products)
      .values({
        name: 'Standard Checkout Item',
        slug: `checkout-prod-${Date.now()}`,
        price: '150.00',
        stock: 100,
        categoryId: testCategoryId,
      })
      .returning();
    testProductId = prod.id;

    const [variant] = await db
      .insert(schema.productVariants)
      .values({
        productId: testProductId,
        sku: `SKU-CHK-${Date.now()}`,
        price: '180.00',
        stock: 50,
        attributes: { color: 'Blue', size: 'M' },
      })
      .returning();
    testVariantId = variant.id;
  });

  afterAll(async () => {
    try {
      if (createdUserIds.length > 0) {
        for (const uid of createdUserIds) {
          await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1', [
            uid,
          ]);
          await pool.query(
            'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)',
            [uid],
          );
          await pool.query('DELETE FROM orders WHERE user_id = $1', [uid]);
          await pool.query('DELETE FROM cart_items WHERE user_id = $1', [uid]);
          await pool.query('DELETE FROM addresses WHERE user_id = $1', [uid]);
          await pool.query('DELETE FROM loyalty_points WHERE user_id = $1', [
            uid,
          ]);
          await pool.query('DELETE FROM users WHERE id = $1', [uid]);
        }
      }
      if (testCategoryId) {
        await pool.query(
          'DELETE FROM cart_items WHERE product_id IN (SELECT id FROM products WHERE category_id = $1)',
          [testCategoryId],
        );
        await pool.query(
          'DELETE FROM order_items WHERE product_id IN (SELECT id FROM products WHERE category_id = $1)',
          [testCategoryId],
        );
        await pool.query(
          'DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE category_id = $1)',
          [testCategoryId],
        );
        await pool.query(
          'DELETE FROM inventory_transactions WHERE product_id IN (SELECT id FROM products WHERE category_id = $1)',
          [testCategoryId],
        );
        await pool.query('DELETE FROM products WHERE category_id = $1', [
          testCategoryId,
        ]);
        await pool.query('DELETE FROM categories WHERE id = $1', [
          testCategoryId,
        ]);
      }
    } finally {
      await pool.end().catch(() => {});
    }
  });

  async function createTestCustomer(): Promise<string> {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `chk_cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@example.com`,
        passwordHash: '$2b$10$insecureplaceholderfortests',
        fullName: 'Checkout Customer',
        phone: '01711002233',
        isPhoneVerified: true,
        role: 'customer',
      })
      .returning();
    createdUserIds.push(user.id);
    return user.id;
  }

  // ── 1. Atomic Stock Deduction & Order Persistence ────────────────────────────

  describe('1. Atomic Checkout & Stock Deductions', () => {
    it('creates order, deducts stock atomically, and records inventory transaction audit', async () => {
      const userId = await createTestCustomer();

      // Add 2 standard items to cart
      await db.insert(schema.cartItems).values({
        userId,
        productId: testProductId,
        variantId: null,
        quantity: 2,
      });

      const initialProd = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, testProductId));
      const initialStock = initialProd[0].stock;

      const order = await ordersService.createOrderFromCart(userId, {
        addressLine1: 'Road 12, House 4',
        city: 'Dhaka',
        phone: '01711002233',
      });

      expect(order).toBeDefined();
      expect(order.status).toBe('pending');
      expect(order.paymentStatus).toBe('unpaid');
      expect(parseFloat(order.totalAmount)).toBe(300.0);

      // Verify DB: Product stock reduced by 2
      const updatedProd = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, testProductId));
      expect(updatedProd[0].stock).toBe(initialStock - 2);

      // Verify DB: Cart is now empty
      const remainingCart = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, userId));
      expect(remainingCart.length).toBe(0);

      // Verify DB: Inventory transaction logged
      const invTx = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.referenceId, order.id));
      expect(invTx.length).toBe(1);
      expect(invTx[0].type).toBe('out');
      expect(invTx[0].quantity).toBe(2);
    });

    it('deducts variant stock when purchasing product variants', async () => {
      const userId = await createTestCustomer();

      // Add 3 variant items to cart
      await db.insert(schema.cartItems).values({
        userId,
        productId: testProductId,
        variantId: testVariantId,
        quantity: 3,
      });

      const initialVar = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, testVariantId));
      const initialVarStock = initialVar[0].stock;

      const order = await ordersService.createOrderFromCart(userId, {
        addressLine1: 'Road 44, Banani',
        city: 'Dhaka',
        phone: '01711002233',
      });

      expect(order).toBeDefined();
      expect(parseFloat(order.totalAmount)).toBe(540.0); // 3 * 180

      const updatedVar = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, testVariantId));
      expect(updatedVar[0].stock).toBe(initialVarStock - 3);
    });

    it('rolls back completely without creating order or deducting stock if any item fails stock check', async () => {
      const userId = await createTestCustomer();

      // Seed a zero-stock item
      const [soldOutProd] = await db
        .insert(schema.products)
        .values({
          name: 'Sold Out Item',
          slug: `sold-out-${Date.now()}`,
          price: '50.00',
          stock: 0,
          categoryId: testCategoryId,
        })
        .returning();

      // Add 1 in-stock item and 1 sold-out item
      await db.insert(schema.cartItems).values([
        { userId, productId: testProductId, variantId: null, quantity: 1 },
        { userId, productId: soldOutProd.id, variantId: null, quantity: 1 },
      ]);

      const initialStock = (
        await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, testProductId))
      )[0].stock;

      await expect(
        ordersService.createOrderFromCart(userId, {
          addressLine1: 'Failing Street',
          city: 'Dhaka',
          phone: '01711002233',
        }),
      ).rejects.toThrow(InsufficientStockError);

      // Verify stock was NOT deducted for testProductId
      const finalStock = (
        await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, testProductId))
      )[0].stock;
      expect(finalStock).toBe(initialStock);

      // Verify zero orders were created
      const orders = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.userId, userId));
      expect(orders.length).toBe(0);

      // Verify cart items were preserved
      const cart = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, userId));
      expect(cart.length).toBe(2);

      // Cleanup
      await pool.query('DELETE FROM cart_items WHERE product_id = $1', [
        soldOutProd.id,
      ]);
      await pool.query('DELETE FROM products WHERE id = $1', [soldOutProd.id]);
    });
  });

  // ── 2. Idempotency & Duplicate Request Protection ────────────────────────────

  describe('2. Idempotency Replay & Tampering Guards', () => {
    it('returns existing order on repeated submission with identical idempotency key', async () => {
      const userId = await createTestCustomer();
      const idempotencyKey = `idemp_key_${Date.now()}`;

      await db.insert(schema.cartItems).values({
        userId,
        productId: testProductId,
        variantId: null,
        quantity: 1,
      });

      const initialStock = (
        await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, testProductId))
      )[0].stock;

      const checkoutDto = {
        addressLine1: 'Gulshan 2, Dhaka',
        city: 'Dhaka',
        phone: '01711223344',
      };

      // 1st Call
      const order1 = await ordersService.createOrderFromCart(
        userId,
        checkoutDto,
        idempotencyKey,
      );
      expect(order1).toBeDefined();

      // 2nd Call (Same key, same payload)
      const order2 = await ordersService.createOrderFromCart(
        userId,
        checkoutDto,
        idempotencyKey,
      );
      expect(order2).toBeDefined();
      expect(order2.id).toBe(order1.id);
      expect(order2.totalAmount).toBe(order1.totalAmount);

      // Verify in database: Exactly 1 order exists for this key
      const ordersInDb = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.userId, userId));
      expect(ordersInDb.length).toBe(1);

      // Verify stock was deducted exactly once (initial - 1)
      const finalStock = (
        await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, testProductId))
      )[0].stock;
      expect(finalStock).toBe(initialStock - 1);

      // Verify idempotency table record
      const idempRecord = await db
        .select()
        .from(schema.idempotencyKeys)
        .where(eq(schema.idempotencyKeys.key, idempotencyKey));
      expect(idempRecord.length).toBe(1);
      expect(idempRecord[0].status).toBe('completed');
      expect(idempRecord[0].orderId).toBe(order1.id);
    });

    it('rejects reuse of the same idempotency key with modified request payload', async () => {
      const userId = await createTestCustomer();
      const idempotencyKey = `idemp_tamper_${Date.now()}`;

      await db.insert(schema.cartItems).values({
        userId,
        productId: testProductId,
        variantId: null,
        quantity: 1,
      });

      // 1st Call with Address A
      await ordersService.createOrderFromCart(
        userId,
        {
          addressLine1: 'Address Original',
          city: 'Dhaka',
          phone: '01711223344',
        },
        idempotencyKey,
      );

      // 2nd Call with Address B (Tampered payload)
      await expect(
        ordersService.createOrderFromCart(
          userId,
          {
            addressLine1: 'Address Tampered',
            city: 'Chittagong',
            phone: '01711223344',
          },
          idempotencyKey,
        ),
      ).rejects.toThrow(
        'Idempotency key has already been used with different request parameters',
      );
    });
  });

  // ── 3. High-Concurrency Stock Racing (Overselling Prevention) ────────────────

  describe('3. High-Concurrency Stock Competition (CONC-03)', () => {
    it('prevents overselling when 5 concurrent buyers compete for 1 unit of stock', async () => {
      // Seed a limited product with stock = 1
      const [limitedProd] = await db
        .insert(schema.products)
        .values({
          name: 'Final Rare Item',
          slug: `final-item-${Date.now()}`,
          price: '500.00',
          stock: 1, // Exactly 1 item available!
          categoryId: testCategoryId,
        })
        .returning();

      // Create 5 distinct buyers and add the single item to each buyer's cart
      const buyers: string[] = [];
      for (let i = 0; i < 5; i++) {
        const uid = await createTestCustomer();
        buyers.push(uid);
        await db.insert(schema.cartItems).values({
          userId: uid,
          productId: limitedProd.id,
          variantId: null,
          quantity: 1,
        });
      }

      // Fire 5 checkout requests simultaneously
      const results = await Promise.allSettled(
        buyers.map((uid) =>
          ordersService.createOrderFromCart(uid, {
            addressLine1: 'Racing Avenue',
            city: 'Dhaka',
            phone: '01711000000',
          }),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // EXACTLY 1 buyer must succeed
      expect(fulfilled.length).toBe(1);
      // EXACTLY 4 buyers must be rejected
      expect(rejected.length).toBe(4);

      // All 4 rejections must be InsufficientStockError
      for (const rej of rejected) {
        const reason = rej.reason;
        expect(reason).toBeInstanceOf(InsufficientStockError);
        expect(reason.message).toMatch(
          /Insufficient stock for "Final Rare Item"|just sold out/,
        );
      }

      // Database boundary assertion: Stock must be exactly 0, never negative
      const finalProd = (
        await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, limitedProd.id))
      )[0];
      expect(finalProd.stock).toBe(0);

      // Database boundary assertion: Exactly 1 order was created for this product
      const createdItems = await pool.query(
        'SELECT * FROM order_items WHERE product_id = $1',
        [limitedProd.id],
      );
      expect(createdItems.rows.length).toBe(1);

      // Cleanup
      await pool.query('DELETE FROM cart_items WHERE product_id = $1', [
        limitedProd.id,
      ]);
      await pool.query('DELETE FROM order_items WHERE product_id = $1', [
        limitedProd.id,
      ]);
      await pool.query(
        'DELETE FROM inventory_transactions WHERE product_id = $1',
        [limitedProd.id],
      );
      await pool.query('DELETE FROM products WHERE id = $1', [limitedProd.id]);
    });

    it('serializes concurrent checkouts by the same user to prevent duplicate orders', async () => {
      const userId = await createTestCustomer();

      // User has 1 item in cart
      await db.insert(schema.cartItems).values({
        userId,
        productId: testProductId,
        variantId: null,
        quantity: 1,
      });

      // User rapidly double-clicks: 3 simultaneous checkout requests
      const results = await Promise.allSettled([
        ordersService.createOrderFromCart(userId, {
          addressLine1: 'Double Click St',
          city: 'Dhaka',
          phone: '01711002233',
        }),
        ordersService.createOrderFromCart(userId, {
          addressLine1: 'Double Click St',
          city: 'Dhaka',
          phone: '01711002233',
        }),
        ordersService.createOrderFromCart(userId, {
          addressLine1: 'Double Click St',
          city: 'Dhaka',
          phone: '01711002233',
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 1 request creates the order
      expect(fulfilled.length).toBe(1);
      // Other requests are serialized, acquire lock, see empty cart and fail safely
      expect(rejected.length).toBe(2);

      for (const rej of rejected) {
        const reason = rej.reason;
        expect(reason).toBeInstanceOf(InvalidOperationError);
        expect(reason.message).toBe('Your cart is empty');
      }

      // Exactly 1 order in DB
      const userOrders = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.userId, userId));
      expect(userOrders.length).toBe(1);
    });
  });

  // ── 4. Order State Machine Transition Matrix Verification ─────────────────────

  describe('4. Order State Machine Transition Matrix', () => {
    it('verifies explicit transition rules in ORDER_STATE_TRANSITIONS matrix', () => {
      expect(ORDER_STATE_TRANSITIONS.pending).toEqual([
        'processing',
        'cancelled',
      ]);
      expect(ORDER_STATE_TRANSITIONS.processing).toEqual([
        'shipped',
        'cancelled',
      ]);
      expect(ORDER_STATE_TRANSITIONS.shipped).toEqual([
        'out_for_delivery',
        'delivered',
      ]);
      expect(ORDER_STATE_TRANSITIONS.out_for_delivery).toEqual(['delivered']);
      expect(ORDER_STATE_TRANSITIONS.delivered).toEqual(['refunded']);
      expect(ORDER_STATE_TRANSITIONS.cancelled).toEqual([]);
      expect(ORDER_STATE_TRANSITIONS.refunded).toEqual([]);
    });

    it('enforces legal forward transitions from pending to delivered', async () => {
      const userId = await createTestCustomer();

      await db.insert(schema.cartItems).values({
        userId,
        productId: testProductId,
        variantId: null,
        quantity: 1,
      });

      const order = await ordersService.createOrderFromCart(userId, {
        addressLine1: 'State Machine Path',
        city: 'Dhaka',
        phone: '01711002233',
      });

      expect(order.status).toBe('pending');

      // pending -> processing
      const step1 = await ordersService.updateOrderStatus(
        order.id,
        'processing',
      );
      expect(step1.status).toBe('processing');

      // processing -> shipped
      const step2 = await ordersService.updateOrderStatus(order.id, 'shipped');
      expect(step2.status).toBe('shipped');

      // shipped -> out_for_delivery
      const step3 = await ordersService.updateOrderStatus(
        order.id,
        'out_for_delivery',
      );
      expect(step3.status).toBe('out_for_delivery');

      // out_for_delivery -> delivered
      const step4 = await ordersService.updateOrderStatus(
        order.id,
        'delivered',
      );
      expect(step4.status).toBe('delivered');
    });

    it('rejects illegal transitions: pending directly to delivered', async () => {
      const userId = await createTestCustomer();

      await db.insert(schema.cartItems).values({
        userId,
        productId: testProductId,
        variantId: null,
        quantity: 1,
      });

      const order = await ordersService.createOrderFromCart(userId, {
        addressLine1: 'Illegal Path',
        city: 'Dhaka',
        phone: '01711002233',
      });

      await expect(
        ordersService.updateOrderStatus(order.id, 'delivered'),
      ).rejects.toThrow(
        "Invalid status transition from 'pending' to 'delivered'",
      );
    });

    it('rejects any transition away from terminal cancelled status', async () => {
      const userId = await createTestCustomer();

      await db.insert(schema.cartItems).values({
        userId,
        productId: testProductId,
        variantId: null,
        quantity: 1,
      });

      const order = await ordersService.createOrderFromCart(userId, {
        addressLine1: 'Terminal Cancelled',
        city: 'Dhaka',
        phone: '01711002233',
      });

      await ordersService.cancelOrder(
        userId,
        order.id,
        'Customer changed mind',
      );

      const cancelledOrder = await ordersStore.findOrderById(order.id);
      expect(cancelledOrder?.status).toBe('cancelled');

      // Attempt to revive cancelled order to processing
      await expect(
        ordersService.updateOrderStatus(order.id, 'processing'),
      ).rejects.toThrow(
        "Invalid status transition from 'cancelled' to 'processing'",
      );

      // Attempt to revive cancelled order to shipped
      await expect(
        ordersService.updateOrderStatus(order.id, 'shipped'),
      ).rejects.toThrow(
        "Invalid status transition from 'cancelled' to 'shipped'",
      );
    });
  });

  describe('5. Transaction Scope & Batch Insertion Optimization (TASK-10)', () => {
    it('executes child record insertions in single multi-row SQL batches and verifies database rows', async () => {
      const userId = await createTestCustomer();

      // Seed 2 cart items (1 standard, 1 variant)
      await db.insert(schema.cartItems).values([
        {
          userId,
          productId: testProductId,
          variantId: null,
          quantity: 2,
        },
        {
          userId,
          productId: testProductId,
          variantId: testVariantId,
          quantity: 1,
        },
      ]);

      const createOrderItemsSpy = jest.spyOn(ordersStore, 'createOrderItems');
      const createInventoryTransactionsSpy = jest.spyOn(
        ordersStore,
        'createInventoryTransactions',
      );
      const createOutboxEventsSpy = jest.spyOn(
        ordersStore,
        'createOutboxEvents',
      );

      const order = await ordersService.createOrderFromCart(userId, {
        addressLine1: '456 Batch Lane',
        city: 'Dhaka',
        phone: '01711223344',
      });

      // Verify batch store methods were executed exactly once
      expect(createOrderItemsSpy).toHaveBeenCalledTimes(1);
      expect(createInventoryTransactionsSpy).toHaveBeenCalledTimes(1);
      expect(createOutboxEventsSpy).toHaveBeenCalledTimes(1);

      // Verify items passed to batch insertion
      expect(createOrderItemsSpy.mock.calls[0][0]).toHaveLength(2);
      expect(createInventoryTransactionsSpy.mock.calls[0][0]).toHaveLength(2);
      expect(createOutboxEventsSpy.mock.calls[0][0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'SEND_ORDER_CONFIRMATION' }),
        ]),
      );

      // Verify real PostgreSQL database persistence
      const persistedItems = await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id));
      expect(persistedItems).toHaveLength(2);

      const persistedTx = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.referenceId, order.id));
      expect(persistedTx).toHaveLength(2);

      const persistedOutbox = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.type, 'SEND_ORDER_CONFIRMATION'));
      const matchingOutbox = persistedOutbox.find(
        (o) => (o.payload as any)?.orderId === order.id,
      );
      expect(matchingOutbox).toBeDefined();

      createOrderItemsSpy.mockRestore();
      createInventoryTransactionsSpy.mockRestore();
      createOutboxEventsSpy.mockRestore();
    });
  });
});

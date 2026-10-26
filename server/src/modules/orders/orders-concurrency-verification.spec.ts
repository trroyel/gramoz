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
  InsufficientStockError,
  ForbiddenOperationError,
} from '../../common/errors/domain.errors';

describe('TASK-17: Comprehensive Orders, Checkout & Payment Concurrency Verification', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let ordersStore: OrdersStore;
  let ordersService: OrdersService;
  let loyaltyStore: LoyaltyStore;
  let loyaltyService: LoyaltyService;
  let settingsStore: SettingsStore;
  let settingsService: SettingsService;
  let promosService: PromosService;
  let paymentsStore: PaymentsStore;
  let paymentsService: PaymentsService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const createdUserIds: string[] = [];
  const createdProductIds: string[] = [];
  let testCategoryId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 25,
    });
    db = drizzle(pool, { schema });

    ordersStore = new OrdersStore(db as any);
    loyaltyStore = new LoyaltyStore(db as any);
    settingsStore = new SettingsStore(db as any);
    paymentsStore = new PaymentsStore(db as any);

    settingsService = new SettingsService(settingsStore);
    loyaltyService = new LoyaltyService(loyaltyStore, settingsService);
    promosService = new PromosService(db as any);

    const mockCourierService = {
      calculateCharge: jest.fn().mockResolvedValue({ charge: 60 }),
      createConsignment: jest
        .fn()
        .mockResolvedValue({ tracking_code: 'TRK-17' }),
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
          SSLCOMMERZ_STORE_SECRET: 'test-secret',
          SSLCOMMERZ_IS_SANDBOX: 'true',
        };
        return values[key] ?? defaultVal;
      },
    } as any;

    paymentsService = new PaymentsService(mockConfig, paymentsStore);

    const [cat] = await db
      .insert(schema.categories)
      .values({
        name: `Task 17 Cat ${Date.now()}`,
        slug: `task-17-cat-${Date.now()}`,
      })
      .returning();
    testCategoryId = cat.id;
  });

  afterAll(async () => {
    try {
      for (const uid of createdUserIds) {
        await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1', [
          uid,
        ]);
        await pool.query(
          'DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)',
          [uid],
        );
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

      for (const pid of createdProductIds) {
        await pool.query('DELETE FROM cart_items WHERE product_id = $1', [pid]);
        await pool.query('DELETE FROM order_items WHERE product_id = $1', [
          pid,
        ]);
        await pool.query('DELETE FROM product_variants WHERE product_id = $1', [
          pid,
        ]);
        await pool.query(
          'DELETE FROM inventory_transactions WHERE product_id = $1',
          [pid],
        );
        await pool.query('DELETE FROM products WHERE id = $1', [pid]);
      }

      if (testCategoryId) {
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
        email: `task17_cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@example.com`,
        passwordHash: '$2b$10$insecureplaceholderfortests',
        fullName: 'Concurrency Customer',
        phone: '01711223344',
        isPhoneVerified: true,
        role: 'customer',
      })
      .returning();
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createTestProduct(
    stock: number,
    price = '100.00',
  ): Promise<string> {
    const [prod] = await db
      .insert(schema.products)
      .values({
        name: `Product Stock ${stock} (${Date.now()})`,
        slug: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        price,
        stock,
        categoryId: testCategoryId,
      })
      .returning();
    createdProductIds.push(prod.id);
    return prod.id;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 4: Real PostgreSQL Checkout Concurrency Tests (CONC-17-A to CONC-17-I)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('PHASE 4: Real PostgreSQL Checkout Concurrency Tests', () => {
    // CONC-17-A: Last Item Race (10 distinct customers concurrently attempt to buy the final unit)
    it('CONC-17-A: Last Item Race — 10 concurrent buyers compete for 1 final unit', async () => {
      const productId = await createTestProduct(1);

      // Create 10 distinct customers and add 1 unit to each cart
      const buyers: string[] = [];
      for (let i = 0; i < 10; i++) {
        const uid = await createTestCustomer();
        buyers.push(uid);
        await db.insert(schema.cartItems).values({
          userId: uid,
          productId,
          variantId: null,
          quantity: 1,
        });
      }

      // Fire 10 concurrent checkouts
      const results = await Promise.allSettled(
        buyers.map((uid) =>
          ordersService.createOrderFromCart(uid, {
            addressLine1: 'CONC-17-A Street',
            city: 'Dhaka',
            phone: '01711000000',
          }),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // EXACTLY 1 must succeed, 9 must be rejected
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(9);

      for (const rej of rejected) {
        expect(rej.reason).toBeInstanceOf(InsufficientStockError);
      }

      // Final inventory in database must be exactly 0, never negative
      const [finalProduct] = await db
        .select({ stock: schema.products.stock })
        .from(schema.products)
        .where(eq(schema.products.id, productId));
      expect(finalProduct.stock).toBe(0);

      // Exactly 1 inventory transaction record of type 'out'
      const invTx = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.productId, productId));
      expect(invTx.length).toBe(1);
      expect(invTx[0].type).toBe('out');
      expect(invTx[0].quantity).toBe(1);

      // Exactly 1 order in database
      const orderItems = await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.productId, productId));
      expect(orderItems.length).toBe(1);
    });

    // CONC-17-B: Product Variant Race (multiple customers purchase final units of a variant)
    it('CONC-17-B: Product Variant Race — concurrent purchase of final variant units', async () => {
      const productId = await createTestProduct(100); // Product has 100 base units

      const [variant] = await db
        .insert(schema.productVariants)
        .values({
          productId,
          sku: `SKU-V-17-${Date.now()}`,
          price: '150.00',
          stock: 1, // Only 1 unit of this specific variant
          attributes: { size: 'XL' },
        })
        .returning();

      const buyers: string[] = [];
      for (let i = 0; i < 5; i++) {
        const uid = await createTestCustomer();
        buyers.push(uid);
        await db.insert(schema.cartItems).values({
          userId: uid,
          productId,
          variantId: variant.id,
          quantity: 1,
        });
      }

      const results = await Promise.allSettled(
        buyers.map((uid) =>
          ordersService.createOrderFromCart(uid, {
            addressLine1: 'Variant Race St',
            city: 'Dhaka',
            phone: '01711000000',
          }),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);

      // Variant stock must be exactly 0
      const [finalVariant] = await db
        .select({ stock: schema.productVariants.stock })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, variant.id));
      expect(finalVariant.stock).toBe(0);

      // Product stock must remain unchanged (100)
      const [prod] = await db
        .select({ stock: schema.products.stock })
        .from(schema.products)
        .where(eq(schema.products.id, productId));
      expect(prod.stock).toBe(100);
    });

    // CONC-17-C: Same-User Duplicate Checkout (10 concurrent requests, same user, same idempotency key)
    it('CONC-17-C: Same-User Duplicate Checkout — 10 concurrent requests with identical idempotency key', async () => {
      const userId = await createTestCustomer();
      const productId = await createTestProduct(50);
      const idempotencyKey = `conc_17_c_${Date.now()}`;

      await db.insert(schema.cartItems).values({
        userId,
        productId,
        variantId: null,
        quantity: 1,
      });

      const checkoutDto = {
        addressLine1: 'Same User Ave',
        city: 'Dhaka',
        phone: '01711223344',
      };

      // 10 concurrent submissions with the same key
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          ordersService.createOrderFromCart(
            userId,
            checkoutDto,
            idempotencyKey,
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      // All successful responses must return the same order ID
      const orderIds = fulfilled.map((f) => f.value.id);
      const uniqueOrderIds = Array.from(new Set(orderIds));

      expect(uniqueOrderIds.length).toBe(1);

      // Exactly 1 order in database
      const userOrders = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.userId, userId));
      expect(userOrders.length).toBe(1);

      // Stock deducted exactly once (50 - 1 = 49)
      const [finalProduct] = await db
        .select({ stock: schema.products.stock })
        .from(schema.products)
        .where(eq(schema.products.id, productId));
      expect(finalProduct.stock).toBe(49);
    });

    // CONC-17-D: Idempotency Key Reuse with different payload
    it('CONC-17-D: Idempotency Key Reuse — rejects modified payload on same key', async () => {
      const userId = await createTestCustomer();
      const productId = await createTestProduct(10);
      const idempotencyKey = `conc_17_d_${Date.now()}`;

      await db.insert(schema.cartItems).values({
        userId,
        productId,
        variantId: null,
        quantity: 1,
      });

      // 1st request with Address A
      const order1 = await ordersService.createOrderFromCart(
        userId,
        {
          addressLine1: 'Legitimate Address',
          city: 'Dhaka',
          phone: '01711223344',
        },
        idempotencyKey,
      );
      expect(order1).toBeDefined();

      // 2nd request with Tampered Address B
      await expect(
        ordersService.createOrderFromCart(
          userId,
          {
            addressLine1: 'Tampered Address',
            city: 'Sylhet',
            phone: '01711223344',
          },
          idempotencyKey,
        ),
      ).rejects.toThrow(
        'Idempotency key has already been used with different request parameters',
      );
    });

    // CONC-17-E: Multi-Item Deadlock (Canonical Lock Ordering)
    it('CONC-17-E: Multi-Item Deadlock — overlapping products in inverted cart orderings execute deadlock-free', async () => {
      const prodA = await createTestProduct(10);
      const prodB = await createTestProduct(10);

      const user1 = await createTestCustomer();
      const user2 = await createTestCustomer();

      // User 1 cart: [A, B]
      await db.insert(schema.cartItems).values([
        { userId: user1, productId: prodA, variantId: null, quantity: 1 },
        { userId: user1, productId: prodB, variantId: null, quantity: 1 },
      ]);

      // User 2 cart: [B, A]
      await db.insert(schema.cartItems).values([
        { userId: user2, productId: prodB, variantId: null, quantity: 1 },
        { userId: user2, productId: prodA, variantId: null, quantity: 1 },
      ]);

      // Concurrently execute both checkouts
      const [res1, res2] = await Promise.allSettled([
        ordersService.createOrderFromCart(user1, {
          addressLine1: 'Deadlock Test 1',
          city: 'Dhaka',
          phone: '01711000000',
        }),
        ordersService.createOrderFromCart(user2, {
          addressLine1: 'Deadlock Test 2',
          city: 'Dhaka',
          phone: '01711000000',
        }),
      ]);

      expect(res1.status).toBe('fulfilled');
      expect(res2.status).toBe('fulfilled');

      // Both products deducted by 2
      const [finalA] = await db
        .select({ stock: schema.products.stock })
        .from(schema.products)
        .where(eq(schema.products.id, prodA));
      const [finalB] = await db
        .select({ stock: schema.products.stock })
        .from(schema.products)
        .where(eq(schema.products.id, prodB));

      expect(finalA.stock).toBe(8);
      expect(finalB.stock).toBe(8);
    });

    // CONC-17-F: Insufficient Stock Rollback
    it('CONC-17-F: Insufficient Stock Rollback — entire checkout rolls back when a later item is sold out', async () => {
      const inStockProd = await createTestProduct(5);
      const soldOutProd = await createTestProduct(0);

      const userId = await createTestCustomer();

      await db.insert(schema.cartItems).values([
        { userId, productId: inStockProd, variantId: null, quantity: 1 },
        { userId, productId: soldOutProd, variantId: null, quantity: 1 },
      ]);

      await expect(
        ordersService.createOrderFromCart(userId, {
          addressLine1: 'Rollback St',
          city: 'Dhaka',
          phone: '01711000000',
        }),
      ).rejects.toThrow(InsufficientStockError);

      // Verify inStockProd stock was NOT deducted
      const [finalInStock] = await db
        .select({ stock: schema.products.stock })
        .from(schema.products)
        .where(eq(schema.products.id, inStockProd));
      expect(finalInStock.stock).toBe(5);

      // 0 orders created
      const orders = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.userId, userId));
      expect(orders.length).toBe(0);

      // Cart items preserved
      const cart = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, userId));
      expect(cart.length).toBe(2);
    });

    // CONC-17-G: Concurrent Cart Mutation (Defect 1 Verification)
    it('CONC-17-G: Concurrent Cart Mutation — only checked-out cart items are deleted; newly added items are preserved', async () => {
      const prodA = await createTestProduct(10);
      const prodB = await createTestProduct(10);
      const userId = await createTestCustomer();

      // Add Item A to cart
      const [cartItemA] = await db
        .insert(schema.cartItems)
        .values({
          userId,
          productId: prodA,
          variantId: null,
          quantity: 1,
        })
        .returning();

      // Spy on findAddress to simulate concurrent addition of Item B while checkout is executing
      const findAddressSpy = jest
        .spyOn(ordersStore, 'findAddress')
        .mockImplementationOnce(async (...args) => {
          // Concurrently add Item B to the database cart
          await db.insert(schema.cartItems).values({
            userId,
            productId: prodB,
            variantId: null,
            quantity: 2,
          });
          // Call original implementation
          return (await (ordersStore as any).findAddress.wrappedMethod)
            ? (ordersStore as any).findAddress.wrappedMethod(...args)
            : null;
        });

      try {
        const order = await ordersService.createOrderFromCart(userId, {
          addressLine1: 'Mutation Ave',
          city: 'Dhaka',
          phone: '01711000000',
        });

        expect(order).toBeDefined();

        // Check user cart in database: Item B MUST still exist! Only Item A was checked out!
        const remainingCart = await db
          .select()
          .from(schema.cartItems)
          .where(eq(schema.cartItems.userId, userId));

        expect(remainingCart.length).toBe(1);
        expect(remainingCart[0].productId).toBe(prodB);
        expect(remainingCart[0].quantity).toBe(2);
      } finally {
        findAddressSpy.mockRestore();
      }
    });

    // CONC-17-H: Concurrent Promotional Redemption
    it('CONC-17-H: Concurrent Promotional Redemption — quota never exceeded under concurrent usage competition', async () => {
      const prod = await createTestProduct(50);
      const [promo] = await db
        .insert(schema.promos)
        .values({
          code: `PROMO_RACE_${Date.now()}`,
          discountType: 'fixed',
          discountValue: '10.00',
          maxUses: 1, // Only 1 use allowed!
          currentUses: 0,
          isActive: true,
        })
        .returning();

      const buyers: string[] = [];
      for (let i = 0; i < 5; i++) {
        const uid = await createTestCustomer();
        buyers.push(uid);
        await db.insert(schema.cartItems).values({
          userId: uid,
          productId: prod,
          variantId: null,
          quantity: 1,
        });
      }

      const results = await Promise.allSettled(
        buyers.map((uid) =>
          ordersService.createOrderFromCart(uid, {
            addressLine1: 'Promo Race St',
            city: 'Dhaka',
            phone: '01711000000',
            promoCode: promo.code,
          }),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);

      // Verify promo current_uses in DB is exactly 1, never > 1
      const [finalPromo] = await db
        .select({ currentUses: schema.promos.currentUses })
        .from(schema.promos)
        .where(eq(schema.promos.id, promo.id));
      expect(finalPromo.currentUses).toBe(1);
    });

    // CONC-17-I: Concurrent Loyalty Redemption
    it('CONC-17-I: Concurrent Loyalty Redemption — loyalty balance cannot become negative under concurrent spend', async () => {
      const userId = await createTestCustomer();
      // Award 50 points
      await loyaltyStore.createTransaction({
        userId,
        points: 50,
        type: 'earned_review_text',
        validUntil: null,
      });

      // Fire 5 concurrent spend requests of 40 points each (total requested = 200, balance = 50)
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          ordersStore.runTransaction(async (tx) => {
            await ordersStore.acquireUserCheckoutLock(userId, tx);
            return await loyaltyService.spendPoints(userId, 40, undefined, tx);
          }),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 1 spend can succeed
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);

      // Final balance must be exactly 10 (50 - 40)
      const finalBalance = await loyaltyStore.getAvailableBalance(userId);
      expect(finalBalance).toBe(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 5: Payment State Machine Concurrency & Race Verification
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('PHASE 5: Payment State Machine Concurrency', () => {
    async function createTestOrderForPayment(
      status: schema.Order['status'] = 'pending',
    ) {
      const userId = await createTestCustomer();
      const [address] = await db
        .insert(schema.addresses)
        .values({
          userId,
          title: 'Pay Address',
          addressLine1: 'Pay Lane',
          city: 'Dhaka',
        })
        .returning();

      const [order] = await db
        .insert(schema.orders)
        .values({
          userId,
          shippingAddressId: address.id,
          totalAmount: '500.00',
          status,
          paymentStatus: 'unpaid',
        })
        .returning();

      return { userId, orderId: order.id };
    }

    it('1 & 7. Duplicate Successful Callback — idempotent processing without duplicate side effects', async () => {
      const { orderId } = await createTestOrderForPayment();
      const tranId = `TRAN_DUP_SUCC_${Date.now()}`;

      await db.insert(schema.payments).values({
        orderId,
        amount: '500.00',
        method: 'SSLCommerz',
        transactionId: tranId,
        status: 'pending',
      });

      const validationData = {
        status: 'VALIDATED',
        amount: '500.00',
        currency: 'BDT',
        tran_id: tranId,
      };

      // 1st Callback
      const res1 = await (paymentsService as any).handleSuccessfulPayment(
        tranId,
        validationData,
      );
      expect(res1.success).toBe(true);

      // 2nd Duplicate Callback
      const res2 = await (paymentsService as any).handleSuccessfulPayment(
        tranId,
        validationData,
      );
      expect(res2.success).toBe(true);
      expect(res2.message).toMatch(/duplicate IPN ignored/i);

      // Order status is processing and paid
      const order = await ordersStore.findOrderById(orderId);
      expect(order?.status).toBe('processing');
      expect(order?.paymentStatus).toBe('paid');
    });

    it('2. Duplicate Failed Callback — idempotent failure recording', async () => {
      const { orderId } = await createTestOrderForPayment();
      const tranId = `TRAN_DUP_FAIL_${Date.now()}`;

      await db.insert(schema.payments).values({
        orderId,
        amount: '500.00',
        method: 'SSLCommerz',
        transactionId: tranId,
        status: 'pending',
      });

      const res1 = await (paymentsService as any).handleFailedPayment(tranId, {
        failedreason: 'User cancelled',
      });
      expect(res1.success).toBe(false);

      const res2 = await (paymentsService as any).handleFailedPayment(tranId, {
        failedreason: 'User cancelled',
      });
      expect(res2.success).toBe(false);
      expect(res2.message).toMatch(/duplicate IPN ignored/i);
    });

    it('4. Failure Callback Arriving After Success — cannot demote paid order to unpaid', async () => {
      const { orderId } = await createTestOrderForPayment();
      const tranId1 = `TRAN_FAIL_LATER_${Date.now()}_1`;
      const tranId2 = `TRAN_SUCC_EARLIER_${Date.now()}_2`;

      // 2 payments: attempt 1 (stale) and attempt 2 (successful)
      await db.insert(schema.payments).values([
        {
          orderId,
          amount: '500.00',
          method: 'SSLCommerz',
          transactionId: tranId1,
          status: 'pending',
        },
        {
          orderId,
          amount: '500.00',
          method: 'SSLCommerz',
          transactionId: tranId2,
          status: 'pending',
        },
      ]);

      // Attempt 2 succeeds first
      await (paymentsService as any).handleSuccessfulPayment(tranId2, {
        status: 'VALIDATED',
        amount: '500.00',
        currency: 'BDT',
        tran_id: tranId2,
      });

      // Verify order is paid
      const orderAfterSucc = await ordersStore.findOrderById(orderId);
      expect(orderAfterSucc?.paymentStatus).toBe('paid');

      // Late failure arrives for Attempt 1
      await (paymentsService as any).handleFailedPayment(tranId1, {
        failedreason: 'Network dropped',
      });

      // CRITICAL ASSERTION: Order paymentStatus MUST REMAIN 'paid'!
      const orderAfterFail = await ordersStore.findOrderById(orderId);
      expect(orderAfterFail?.paymentStatus).toBe('paid');
      expect(orderAfterFail?.status).toBe('processing');
    });

    it('5. Late Payment After Cancellation — preserves financial evidence and flags RECONCILIATION_REQUIRED', async () => {
      const { userId, orderId } = await createTestOrderForPayment('pending');
      const tranId = `TRAN_LATE_${Date.now()}`;

      await db.insert(schema.payments).values({
        orderId,
        amount: '500.00',
        method: 'SSLCommerz',
        transactionId: tranId,
        status: 'pending',
      });

      // Cancel the order first
      await ordersService.cancelOrder(
        userId,
        orderId,
        'Customer cancelled before payment',
      );

      const cancelledOrder = await ordersStore.findOrderById(orderId);
      expect(cancelledOrder?.status).toBe('cancelled');

      // Late payment arrives from gateway and confirms SUCCESS
      const res = await (paymentsService as any).handleSuccessfulPayment(
        tranId,
        {
          status: 'VALIDATED',
          amount: '500.00',
          currency: 'BDT',
          tran_id: tranId,
        },
      );

      expect(res.success).toBe(true);
      expect(res.message).toMatch(/reconciliation flagged/i);

      // Order must REMAIN cancelled (never revived!)
      const finalOrder = await ordersStore.findOrderById(orderId);
      expect(finalOrder?.status).toBe('cancelled');
      expect(finalOrder?.paymentStatus).toBe('paid');

      // Payment record is marked completed
      const finalPayment =
        await paymentsStore.findPaymentByTransactionId(tranId);
      expect(finalPayment?.status).toBe('completed');

      // Atomic outbox event RECONCILIATION_REQUIRED must exist in database!
      const outbox = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.type, 'RECONCILIATION_REQUIRED'));
      const matchingEvent = outbox.find(
        (e) => (e.payload as any)?.orderId === orderId,
      );
      expect(matchingEvent).toBeDefined();
      expect((matchingEvent?.payload as any)?.amount).toBe('500.00');
    });

    it('6. Order Expiry vs Payment Success Race — paid order cannot be expired', async () => {
      const { orderId } = await createTestOrderForPayment('pending');
      const tranId = `TRAN_EXP_RACE_${Date.now()}`;

      await db.insert(schema.payments).values({
        orderId,
        amount: '500.00',
        method: 'SSLCommerz',
        transactionId: tranId,
        status: 'pending',
      });

      // Payment succeeds first
      await (paymentsService as any).handleSuccessfulPayment(tranId, {
        status: 'VALIDATED',
        amount: '500.00',
        currency: 'BDT',
        tran_id: tranId,
      });

      // Stale expiry worker attempts to expire the order
      await expect(
        ordersService.expireOrder(orderId, 'Session timeout'),
      ).rejects.toThrow(/only pending orders can expire|already been paid/i);

      // Order remains in processing / paid
      const finalOrder = await ordersStore.findOrderById(orderId);
      expect(finalOrder?.status).toBe('processing');
      expect(finalOrder?.paymentStatus).toBe('paid');
    });

    it('9. Callback Referencing a Different Order (Transaction ID mismatch) is rejected', async () => {
      const { orderId } = await createTestOrderForPayment();
      const tranId = `TRAN_EXPECTED_${Date.now()}`;

      await db.insert(schema.payments).values({
        orderId,
        amount: '500.00',
        method: 'SSLCommerz',
        transactionId: tranId,
        status: 'pending',
      });

      const res = await (paymentsService as any).handleSuccessfulPayment(
        tranId,
        {
          status: 'VALIDATED',
          amount: '500.00',
          currency: 'BDT',
          tran_id: 'TRAN_FORGED_DIFFERENT', // Gateway reports different tran_id!
        },
      );

      expect(res.success).toBe(false);
      expect(res.message).toMatch(/Transaction ID mismatch/i);

      // Payment must NOT be marked completed
      const payment = await paymentsStore.findPaymentByTransactionId(tranId);
      expect(payment?.status).toBe('pending');
    });

    it('10. Amount Mismatch is rejected', async () => {
      const { orderId } = await createTestOrderForPayment();
      const tranId = `TRAN_AMOUNT_MISMATCH_${Date.now()}`;

      await db.insert(schema.payments).values({
        orderId,
        amount: '500.00',
        method: 'SSLCommerz',
        transactionId: tranId,
        status: 'pending',
      });

      const res = await (paymentsService as any).handleSuccessfulPayment(
        tranId,
        {
          status: 'VALIDATED',
          amount: '100.00', // Only 100 paid for a 500 order!
          currency: 'BDT',
          tran_id: tranId,
        },
      );

      expect(res.success).toBe(false);
      expect(res.message).toMatch(/amount mismatch/i);

      const payment = await paymentsStore.findPaymentByTransactionId(tranId);
      expect(payment?.status).toBe('pending');
    });

    it('11. Currency Mismatch is rejected', async () => {
      const { orderId } = await createTestOrderForPayment();
      const tranId = `TRAN_CURRENCY_MISMATCH_${Date.now()}`;

      await db.insert(schema.payments).values({
        orderId,
        amount: '500.00',
        method: 'SSLCommerz',
        transactionId: tranId,
        status: 'pending',
      });

      const res = await (paymentsService as any).handleSuccessfulPayment(
        tranId,
        {
          status: 'VALIDATED',
          amount: '500.00',
          currency: 'USD', // Paid in USD instead of BDT!
          tran_id: tranId,
        },
      );

      expect(res.success).toBe(false);
      expect(res.message).toMatch(/currency mismatch/i);

      const payment = await paymentsStore.findPaymentByTransactionId(tranId);
      expect(payment?.status).toBe('pending');
    });

    it('14. Concurrent Payment Initiation — serialized by row lock to prevent duplicate payment records', async () => {
      const { userId, orderId } = await createTestOrderForPayment();

      // Fire 5 concurrent initiateCod requests for the same order
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          paymentsService.initiateCod(userId, orderId),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 1 must succeed; 4 must be rejected
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);

      // Exactly 1 payment in database
      const payments = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, orderId));
      expect(payments.length).toBe(1);
      expect(payments[0].method).toBe('COD');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 6: Cancellation & Expiry Concurrency
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('PHASE 6: Cancellation & Expiry Concurrency', () => {
    it('Customer Cancellation repeated twice — second attempt rejected', async () => {
      const userId = await createTestCustomer();
      const prod = await createTestProduct(10);

      await db.insert(schema.cartItems).values({
        userId,
        productId: prod,
        variantId: null,
        quantity: 1,
      });

      const order = await ordersService.createOrderFromCart(userId, {
        addressLine1: 'Double Cancel',
        city: 'Dhaka',
        phone: '01711000000',
      });

      const res1 = await ordersService.cancelOrder(userId, order.id);
      expect(res1.status).toBe('cancelled');

      await expect(ordersService.cancelOrder(userId, order.id)).rejects.toThrow(
        InvalidOperationError,
      );

      // Stock restored exactly once (initial 10 - 1 + 1 = 10)
      const [finalProd] = await db
        .select({ stock: schema.products.stock })
        .from(schema.products)
        .where(eq(schema.products.id, prod));
      expect(finalProd.stock).toBe(10);
    });

    it('Admin Cancellation simultaneous with Customer Cancellation — exactly-once execution', async () => {
      const userId = await createTestCustomer();
      const prod = await createTestProduct(10);

      await db.insert(schema.cartItems).values({
        userId,
        productId: prod,
        variantId: null,
        quantity: 2,
      });

      const order = await ordersService.createOrderFromCart(userId, {
        addressLine1: 'Admin Sim Cancel',
        city: 'Dhaka',
        phone: '01711000000',
      });

      // Fire customer cancellation and admin cancellation simultaneously
      const results = await Promise.allSettled([
        ordersService.cancelOrder(userId, order.id, 'Customer cancellation'),
        ordersService.updateOrderStatus(order.id, 'cancelled'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Stock restored exactly once
      const [finalProd] = await db
        .select({ stock: schema.products.stock })
        .from(schema.products)
        .where(eq(schema.products.id, prod));
      expect(finalProd.stock).toBe(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 8: Transaction Fault Injection
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('PHASE 8: Transaction Fault Injection', () => {
    it('Mid-transaction crash after stock deduction rolls back completely', async () => {
      const userId = await createTestCustomer();
      const prod = await createTestProduct(20);

      await db.insert(schema.cartItems).values({
        userId,
        productId: prod,
        variantId: null,
        quantity: 3,
      });

      // Inject fault during order creation
      const createOrderSpy = jest
        .spyOn(ordersStore, 'createOrder')
        .mockRejectedValueOnce(
          new Error('Simulated DB connection crash during order insertion'),
        );

      try {
        await expect(
          ordersService.createOrderFromCart(userId, {
            addressLine1: 'Crash Ave',
            city: 'Dhaka',
            phone: '01711000000',
          }),
        ).rejects.toThrow(
          'Simulated DB connection crash during order insertion',
        );

        // Stock was rolled back to 20
        const [finalProd] = await db
          .select({ stock: schema.products.stock })
          .from(schema.products)
          .where(eq(schema.products.id, prod));
        expect(finalProd.stock).toBe(20);

        // 0 orders created
        const orders = await db
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.userId, userId));
        expect(orders.length).toBe(0);

        // Cart items preserved
        const cart = await db
          .select()
          .from(schema.cartItems)
          .where(eq(schema.cartItems.userId, userId));
        expect(cart.length).toBe(1);
      } finally {
        createOrderSpy.mockRestore();
      }
    });
  });
});

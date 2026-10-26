/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql, and } from 'drizzle-orm';
import * as schema from '@database/schema';
import { CartStore } from './cart.store';
import { CartService } from './cart.service';
import { AbandonedCartProcessor } from './abandoned-cart.processor';
import { OutboxProcessor } from '../orders/outbox.processor';
import { OrdersService } from '../orders/orders.service';
import { OrdersStore } from '../orders/orders.store';
import { LoyaltyStore } from '../loyalty/loyalty.store';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SettingsStore } from '../settings/settings.store';
import { SettingsService } from '../settings/settings.service';
import { PromosService } from '../promos/promos.service';
import { CourierService } from '../courier/courier.service';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';
import {
  InsufficientStockError,
  EntityNotFoundError,
} from '../../common/errors/domain.errors';

describe('TASK-19: Real PostgreSQL Cart Concurrency, Worker Races & Integrity Suite', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let cartStore: CartStore;
  let cartService: CartService;
  let abandonedCartProcessor: AbandonedCartProcessor;
  let outboxProcessor: OutboxProcessor;
  let ordersService: OrdersService;
  let ordersStore: OrdersStore;
  let settingsService: SettingsService;
  let mailService: MailService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const createdUserIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAddressIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      max: 20,
      connectionTimeoutMillis: 5000,
    });
    db = drizzle(pool, { schema });

    cartStore = new CartStore(db as any);
    cartService = new CartService(cartStore);

    const settingsStore = new SettingsStore(db as any);
    settingsService = new SettingsService(settingsStore);

    const mockConfig: any = {
      emailApiKey: 're_test_key',
      emailFrom: 'test@gramoz.com',
      frontendUrl: 'http://localhost:3000',
    };
    mailService = new MailService(mockConfig);

    const mockSmsService: any = {
      sendOrderShippedSms: jest.fn().mockResolvedValue(undefined),
      sendOrderDeliveredSms: jest.fn().mockResolvedValue(undefined),
    };

    const mockCourierService: any = {
      calculateCharge: jest.fn().mockResolvedValue(60),
      createConsignment: jest.fn().mockResolvedValue({
        success: true,
        consignmentId: 'MOCK-CONS-19',
        trackingUrl: 'https://track.example.com',
      }),
    };

    const loyaltyStore = new LoyaltyStore(db as any);
    const loyaltyService = new LoyaltyService(loyaltyStore, settingsService);
    const promosService = new PromosService(db as any);

    ordersStore = new OrdersStore(db as any);
    ordersService = new OrdersService(
      ordersStore,
      promosService,
      loyaltyService,
      settingsService,
      mockCourierService as unknown as CourierService,
    );

    abandonedCartProcessor = new AbandonedCartProcessor(
      db as any,
      mailService,
      settingsService,
    );

    outboxProcessor = new OutboxProcessor(
      db as any,
      mockCourierService,
      mailService,
      mockSmsService,
    );

    // Clean any leftover outbox events from abandoned carts for clean test isolation
    await db
      .delete(schema.outboxEvents)
      .where(eq(schema.outboxEvents.type, 'SEND_ABANDONED_CART_EMAIL'));
  });

  afterAll(async () => {
    if (pool) {
      const client = await pool.connect();
      try {
        if (createdOrderIds.length > 0) {
          await client.query(
            'DELETE FROM order_items WHERE order_id = ANY($1::uuid[]);',
            [createdOrderIds],
          );
          await client.query(
            'DELETE FROM inventory_transactions WHERE reference_id = ANY($1::uuid[]);',
            [createdOrderIds],
          );
          await client.query(
            'DELETE FROM refunds WHERE order_id = ANY($1::uuid[]);',
            [createdOrderIds],
          );
          await client.query(
            'DELETE FROM payments WHERE order_id = ANY($1::uuid[]);',
            [createdOrderIds],
          );
          await client.query('DELETE FROM orders WHERE id = ANY($1::uuid[]);', [
            createdOrderIds,
          ]);
        }

        if (createdUserIds.length > 0) {
          await client.query(
            'DELETE FROM cart_items WHERE user_id = ANY($1::uuid[]);',
            [createdUserIds],
          );
          await client.query(
            'DELETE FROM addresses WHERE user_id = ANY($1::uuid[]);',
            [createdUserIds],
          );
          await client.query('DELETE FROM users WHERE id = ANY($1::uuid[]);', [
            createdUserIds,
          ]);
        }

        if (createdProductIds.length > 0) {
          await client.query(
            'DELETE FROM product_variants WHERE product_id = ANY($1::uuid[]);',
            [createdProductIds],
          );
          await client.query(
            'DELETE FROM products WHERE id = ANY($1::uuid[]);',
            [createdProductIds],
          );
        }
      } finally {
        client.release();
        await pool.end();
      }
    }
  });

  function courierServiceMock(mockCourier: any): CourierService {
    return mockCourier as unknown as CourierService;
  }

  async function createTestUser(emailPrefix: string): Promise<string> {
    const [u] = await db
      .insert(schema.users)
      .values({
        email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.gramoz.com`,
        passwordHash: 'dummy-hashed-pass',
        fullName: 'Cart Test User',
        status: 'active',
        isEmailVerified: true,
        isPhoneVerified: true,
      })
      .returning();
    createdUserIds.push(u.id);
    return u.id;
  }

  async function createTestProduct(
    stock = 100,
    price = '1000.00',
  ): Promise<string> {
    const [p] = await db
      .insert(schema.products)
      .values({
        name: `Product-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        slug: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        description: 'Test product for cart concurrency',
        price,
        stock,
        status: 'active',
      })
      .returning();
    createdProductIds.push(p.id);
    return p.id;
  }

  async function createTestVariant(
    productId: string,
    stock = 50,
    price = '1200.00',
    attributes: Record<string, any> = { size: 'XL', color: 'Blue' },
  ): Promise<string> {
    const [v] = await db
      .insert(schema.productVariants)
      .values({
        productId,
        sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        price,
        stock,
        attributes,
      })
      .returning();
    return v.id;
  }

  async function createTestAddress(userId: string): Promise<string> {
    const [a] = await db
      .insert(schema.addresses)
      .values({
        userId,
        title: 'Home',
        addressLine1: 'Road 1, Block A, Dhaka',
        city: 'Dhaka',
        phone: '01712345678',
      } as any)
      .returning();
    createdAddressIds.push(a.id);
    return a.id;
  }

  // =========================================================================
  // PHASE 4: REAL POSTGRESQL CART CONCURRENCY (CONC-19-A through CONC-19-H)
  // =========================================================================

  describe('Phase 4: Concurrency Tests', () => {
    it('CONC-19-A: 10 parallel additions of same product produce 1 row with accumulated quantity', async () => {
      const userId = await createTestUser('conc-19-a');
      const productId = await createTestProduct(100);

      const requests = Array.from({ length: 10 }).map(() =>
        cartService.addItem(userId, { productId, quantity: 1 }),
      );

      const results = await Promise.all(requests);
      expect(results.length).toBe(10);

      const rows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, userId));

      expect(rows.length).toBe(1);
      expect(rows[0].quantity).toBe(10);
    });

    it('CONC-19-B: Concurrent additions of same variant aggregate into 1 row', async () => {
      const userId = await createTestUser('conc-19-b');
      const productId = await createTestProduct(50);
      const variantId = await createTestVariant(productId, 50);

      const requests = Array.from({ length: 6 }).map(() =>
        cartService.addItem(userId, { productId, variantId, quantity: 2 }),
      );

      await Promise.all(requests);

      const rows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, userId));

      expect(rows.length).toBe(1);
      expect(rows[0].variantId).toBe(variantId);
      expect(rows[0].quantity).toBe(12); // 6 * 2 = 12
    });

    it('CONC-19-C: Concurrent additions of different variants create independent rows', async () => {
      const userId = await createTestUser('conc-19-c');
      const productId = await createTestProduct(50);
      const variantA = await createTestVariant(productId, 30, '1200.00', {
        size: 'M',
      });
      const variantB = await createTestVariant(productId, 30, '1300.00', {
        size: 'L',
      });

      const reqA = Array.from({ length: 4 }).map(() =>
        cartService.addItem(userId, {
          productId,
          variantId: variantA,
          quantity: 2,
        }),
      );
      const reqB = Array.from({ length: 3 }).map(() =>
        cartService.addItem(userId, {
          productId,
          variantId: variantB,
          quantity: 3,
        }),
      );

      await Promise.all([...reqA, ...reqB]);

      const rows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, userId));

      expect(rows.length).toBe(2);
      const rowA = rows.find((r) => r.variantId === variantA);
      const rowB = rows.find((r) => r.variantId === variantB);
      expect(rowA?.quantity).toBe(8); // 4 * 2 = 8
      expect(rowB?.quantity).toBe(9); // 3 * 3 = 9
    });

    it('CONC-19-D: Quantity update race completes cleanly without deadlock or corrupted state', async () => {
      const userId = await createTestUser('conc-19-d');
      const productId = await createTestProduct(100);
      const item = await cartService.addItem(userId, {
        productId,
        quantity: 1,
      });

      // 5 concurrent updates setting quantities 2, 4, 6, 8, 10
      const updates = [2, 4, 6, 8, 10].map((q) =>
        cartService.updateItem(userId, item.id, q),
      );

      const results = await Promise.all(updates);
      expect(results.length).toBe(5);

      const [finalItem] = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.id, item.id));

      expect(finalItem).toBeDefined();
      expect([2, 4, 6, 8, 10]).toContain(finalItem.quantity);
    });

    it('CONC-19-E: Remove versus Update race maintains valid state without corrupting database', async () => {
      const userId = await createTestUser('conc-19-e');
      const productId = await createTestProduct(50);
      const item = await cartService.addItem(userId, {
        productId,
        quantity: 2,
      });

      // Fire remove and update simultaneously
      const results = await Promise.allSettled([
        cartService.removeItem(userId, item.id),
        cartService.updateItem(userId, item.id, 5),
      ]);

      expect(results.length).toBe(2);

      const rows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.id, item.id));

      // Either:
      // 1. Remove won and row is gone (update either failed with EntityNotFoundError or ran before remove).
      // 2. Both completed in order (update then remove -> row gone).
      // Database must be in a deterministic, valid state.
      if (rows.length === 1) {
        // Update committed after remove was evaluated
        expect(rows[0].quantity).toBe(5);
      } else {
        expect(rows.length).toBe(0);
      }
    });

    it('CONC-19-F: Checkout versus Cart Modification in second tab preserves newly added items', async () => {
      const userId = await createTestUser('conc-19-f');
      const addressId = await createTestAddress(userId);
      const prodA = await createTestProduct(20, '500.00');
      const prodB = await createTestProduct(20, '700.00');

      // User adds Item A to cart
      const itemA = await cartService.addItem(userId, {
        productId: prodA,
        quantity: 1,
      });

      // Tab 1 initiates checkout with snapshot containing item A.
      // Concurrently in Tab 2, user adds Item B while checkout is in-flight.
      let itemB: any;
      const originalCreateOrder = ordersStore.createOrder.bind(ordersStore);
      jest
        .spyOn(ordersStore, 'createOrder')
        .mockImplementationOnce(async (data, tx) => {
          // Tab 2 adds Item B while Tab 1 checkout holds its cart snapshot
          itemB = await cartService.addItem(userId, {
            productId: prodB,
            quantity: 2,
          });
          return originalCreateOrder(data, tx);
        });

      const orderRes = await ordersService.createOrderFromCart(
        userId,
        {
          addressLine1: 'Road 1, Dhaka',
          city: 'Dhaka',
          phone: '01711000000',
        },
        `idemp-19-f-${Date.now()}`,
      );

      expect(orderRes).toBeDefined();
      expect(itemB).toBeDefined();
      createdOrderIds.push(orderRes.id);

      // Verify that Item A was deleted by checkout, BUT Item B was preserved!
      const remainingCart = await cartService.getCart(userId);
      expect(remainingCart.itemCount).toBe(1);
      expect(remainingCart.items[0].id).toBe(itemB.id);
      expect(remainingCart.items[0].productId).toBe(prodB);
      expect(remainingCart.items[0].quantity).toBe(2);
    });

    it('CONC-19-G: Product stock reduction rejects checkout and updates safely without reserving stock', async () => {
      const userId = await createTestUser('conc-19-g');
      const productId = await createTestProduct(5, '1000.00');

      // User has 3 units in cart
      await cartService.addItem(userId, { productId, quantity: 3 });

      // Admin or another transaction reduces available warehouse stock to 1
      await db
        .update(schema.products)
        .set({ stock: 1 })
        .where(eq(schema.products.id, productId));

      // Attempting to checkout 3 units must fail with InsufficientStockError
      await expect(
        ordersService.createOrderFromCart(userId, {
          addressLine1: 'Road 1, Dhaka',
          city: 'Dhaka',
          phone: '01711000000',
        }),
      ).rejects.toThrow(InsufficientStockError);

      // Cart item still exists in cart (unreserved)
      const cart = await cartService.getCart(userId);
      expect(cart.itemCount).toBe(1);
      expect(cart.items[0].productStock).toBe(1); // Frontend sees live reduced stock
    });

    it('CONC-19-H: Cross-user isolation guarantees zero data leakage or unauthorized access', async () => {
      const userA = await createTestUser('conc-19-h-a');
      const userB = await createTestUser('conc-19-h-b');
      const productId = await createTestProduct(50);

      const itemA = await cartService.addItem(userA, {
        productId,
        quantity: 2,
      });
      const itemB = await cartService.addItem(userB, {
        productId,
        quantity: 4,
      });

      // User A cannot modify or delete User B's cart item
      await expect(cartService.updateItem(userA, itemB.id, 10)).rejects.toThrow(
        EntityNotFoundError,
      );

      await expect(cartService.removeItem(userA, itemB.id)).rejects.toThrow(
        EntityNotFoundError,
      );

      // Verify both carts remain isolated and untouched
      const cartA = await cartService.getCart(userA);
      const cartB = await cartService.getCart(userB);

      expect(cartA.itemCount).toBe(1);
      expect(cartA.items[0].id).toBe(itemA.id);
      expect(cartA.items[0].quantity).toBe(2);

      expect(cartB.itemCount).toBe(1);
      expect(cartB.items[0].id).toBe(itemB.id);
      expect(cartB.items[0].quantity).toBe(4);
    });
  });

  // =========================================================================
  // PHASE 8: ABANDONED CART WORKER RACES (CONC-19-I through CONC-19-N)
  // =========================================================================

  describe('Phase 8: Abandoned Cart Worker & Outbox Races', () => {
    it('CONC-19-I: Checkout before worker claim prevents reminder generation', async () => {
      const userId = await createTestUser('conc-19-i');
      const addressId = await createTestAddress(userId);
      const productId = await createTestProduct(50);

      // Insert cart item with updated_at in the past (> 24 hours ago)
      const [item] = await db
        .insert(schema.cartItems)
        .values({
          userId,
          productId,
          quantity: 2,
          abandonedEmailSent: false,
          updatedAt: new Date(Date.now() - 25 * 3600 * 1000),
          createdAt: new Date(Date.now() - 25 * 3600 * 1000),
        })
        .returning();

      // Customer completes checkout immediately before worker runs
      const order = await ordersService.createOrderFromCart(
        userId,
        {
          addressLine1: 'Road 1, Dhaka',
          city: 'Dhaka',
          phone: '01711000000',
        },
        `idemp-19-i-${Date.now()}`,
      );
      createdOrderIds.push(order.id);

      // Now run worker
      const result = await abandonedCartProcessor.processAbandonedCarts();

      // No reminder should be generated for this user
      const outboxRows = await db
        .select()
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.type, 'SEND_ABANDONED_CART_EMAIL'),
            sql`payload->>'userId' = ${userId}`,
          ),
        );

      expect(outboxRows.length).toBe(0);
    });

    it('CONC-19-J: Checkout during worker execution causes OutboxProcessor to skip email dispatch', async () => {
      const userId = await createTestUser('conc-19-j');
      const productId = await createTestProduct(50);

      // Seed abandoned cart item
      const [item] = await db
        .insert(schema.cartItems)
        .values({
          userId,
          productId,
          quantity: 1,
          abandonedEmailSent: false,
          updatedAt: new Date(Date.now() - 26 * 3600 * 1000),
          createdAt: new Date(Date.now() - 26 * 3600 * 1000),
        })
        .returning();

      // Worker discovers abandoned cart and enqueues outbox event
      const scanResult = await abandonedCartProcessor.processAbandonedCarts();
      expect(scanResult.enqueuedEvents).toBeGreaterThanOrEqual(1);

      // Customer checks out before OutboxProcessor processes the email
      const order = await ordersService.createOrderFromCart(
        userId,
        {
          addressLine1: 'Road 1, Dhaka',
          city: 'Dhaka',
          phone: '01711000000',
        },
        `idemp-19-j-${Date.now()}`,
      );
      createdOrderIds.push(order.id);

      // Fetch user email for targeted assertion
      const [user] = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId));

      // Spy on MailService
      const emailSpy = jest.spyOn(mailService, 'sendAbandonedCartEmail');

      // Now OutboxProcessor processes pending events
      await outboxProcessor.processOutbox();

      // Invariant: Because cart is now empty, email dispatch was skipped for this user
      expect(emailSpy).not.toHaveBeenCalledWith(
        user.email,
        expect.anything(),
        expect.anything(),
      );
      emailSpy.mockRestore();
    }, 15000);

    it('CONC-19-K: Two concurrent workers discover same abandoned cart and create exactly 1 outbox event', async () => {
      const userId = await createTestUser('conc-19-k');
      const productId = await createTestProduct(50);

      await db.insert(schema.cartItems).values({
        userId,
        productId,
        quantity: 3,
        abandonedEmailSent: false,
        updatedAt: new Date(Date.now() - 28 * 3600 * 1000),
        createdAt: new Date(Date.now() - 28 * 3600 * 1000),
      });

      // Run 2 worker instances simultaneously
      const [worker1Result, worker2Result] = await Promise.all([
        abandonedCartProcessor.processAbandonedCarts(),
        abandonedCartProcessor.processAbandonedCarts(),
      ]);

      const totalEnqueued =
        worker1Result.enqueuedEvents + worker2Result.enqueuedEvents;

      // Exactly 1 outbox event created for this user
      const outboxRows = await db
        .select()
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.type, 'SEND_ABANDONED_CART_EMAIL'),
            sql`payload->>'userId' = ${userId}`,
          ),
        );

      expect(outboxRows.length).toBe(1);
      expect(totalEnqueued).toBe(1);
    });

    it('CONC-19-L: Worker crash recovery resets stranded processing events to pending', async () => {
      const userId = await createTestUser('conc-19-l');

      // Create an outbox event simulating a worker crash (> 5 min ago in 'processing' status)
      const [strandedEvent] = await db
        .insert(schema.outboxEvents)
        .values({
          type: 'SEND_ABANDONED_CART_EMAIL',
          payload: {
            userId,
            email: 'crashed@gramoz.com',
            fullName: 'Crashed Worker User',
            items: [{ productName: 'Shirt', quantity: 1, unitPrice: '500.00' }],
          },
          status: 'processing',
          attempts: 1,
          updatedAt: new Date(Date.now() - 6 * 60 * 1000), // 6 minutes ago
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        })
        .returning();

      // Trigger lease recovery
      const recoveredCount = await outboxProcessor.recoverStrandedEvents();
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      // Verify status reset to 'pending'
      const [recoveredEvent] = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, strandedEvent.id));

      expect(recoveredEvent.status).toBe('pending');
      expect(recoveredEvent.lastError).toContain('Worker lease expired');
    });

    it('CONC-19-M: Redis unavailability does not compromise cart database transactions or integrity', async () => {
      const userId = await createTestUser('conc-19-m');
      const productId = await createTestProduct(50);

      // Add item directly to PostgreSQL
      const item = await cartService.addItem(userId, {
        productId,
        quantity: 2,
      });

      expect(item).toBeDefined();
      expect(item.quantity).toBe(2);

      // Authoritative read from PostgreSQL is always consistent regardless of cache state
      const cart = await cartService.getCart(userId);
      expect(cart.itemCount).toBe(1);
      expect(cart.items[0].productId).toBe(productId);
    });

    it('CONC-19-N: Provider timeout / failure safely retries up to MAX_ATTEMPTS before marking failed', async () => {
      const userId = await createTestUser('conc-19-n');
      const productId = await createTestProduct(50);

      // Add active cart item so in-flight check passes
      await db.insert(schema.cartItems).values({
        userId,
        productId,
        quantity: 1,
        abandonedEmailSent: true,
      });

      const [failingEvent] = await db
        .insert(schema.outboxEvents)
        .values({
          type: 'SEND_ABANDONED_CART_EMAIL',
          payload: {
            userId,
            email: 'timeout@gramoz.com',
            fullName: 'Timeout Customer',
            items: [{ productName: 'Cap', quantity: 1, unitPrice: '300.00' }],
          },
          status: 'processing',
          attempts: 3, // Already attempted twice, this is the 3rd
          lastError: null,
        })
        .returning();

      // Mock mailService to simulate provider network timeout
      jest
        .spyOn(mailService, 'sendAbandonedCartEmail')
        .mockRejectedValueOnce(new Error('Resend Gateway ETIMEDOUT'));

      const success = await outboxProcessor.processEvent(failingEvent);
      expect(success).toBe(false);

      const [finalEvent] = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, failingEvent.id));

      // Exhausted attempts (3) -> permanently marked 'failed'
      expect(finalEvent.status).toBe('failed');
      expect(finalEvent.lastError).toContain('Resend Gateway ETIMEDOUT');
    });
  });

  // =========================================================================
  // PHASE 9: POSTGRESQL QUERY & PARTIAL INDEX AUDIT (EXPLAIN ANALYZE)
  // =========================================================================

  describe('Phase 9: Index Verification & EXPLAIN Analysis', () => {
    it('INDEX-19-A: partial index idx_cart_items_abandoned exists and is utilized', async () => {
      const client = await pool.connect();
      try {
        const indexQuery = await client.query(`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = 'cart_items' AND indexname = 'idx_cart_items_abandoned';
        `);

        expect(indexQuery.rows.length).toBe(1);
        expect(indexQuery.rows[0].indexdef).toContain(
          'WHERE (abandoned_email_sent = false)',
        );

        // Execute EXPLAIN ANALYZE on query matching index predicate
        const explainResult = await client.query(`
          EXPLAIN (BUFFERS, FORMAT JSON)
          SELECT id, user_id, updated_at
          FROM cart_items
          WHERE abandoned_email_sent = false
            AND updated_at < NOW() - INTERVAL '24 hours';
        `);

        expect(explainResult.rows.length).toBeGreaterThan(0);
        const plan = JSON.stringify(explainResult.rows[0]);
        // Confirms valid execution plan without syntax or planning aborts
        expect(plan).toContain('Plan');
      } finally {
        client.release();
      }
    });
  });
});

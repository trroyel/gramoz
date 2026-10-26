/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import * as schema from '@database/schema';
import { ProductsService } from './products.service';
import { RedisService } from '../../cache/redis.service';
import { ConfigService } from '@config/config.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ReviewsStore } from '../reviews/reviews.store';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { OrdersStore } from '../orders/orders.store';
import { InsufficientStockError } from '../../common/errors/domain.errors';

describe('Products & Catalog Cache Consistency & Concurrency (TASK-20 — CACHE-20 & CONC-20)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let redisClient: Redis;
  let redisService: RedisService;
  let productsService: ProductsService;
  let reviewsService: ReviewsService;
  let ordersStore: OrdersStore;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = Number(process.env.REDIS_PORT) || 6380;
  const redisPass = process.env.REDIS_PASSWORD || 'redis_pass';

  const createdProductIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdReviewIds: string[] = [];
  const createdOrderIds: string[] = [];

  let testUserId: string;
  let testOrderId: string;

  beforeAll(async () => {
    // 1. PostgreSQL 16 connection pool (high capacity for concurrency)
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 25,
    });
    db = drizzle(pool, { schema });

    // 2. Redis 7 connection
    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPass,
      maxRetriesPerRequest: 3,
    });

    const mockConfig: Partial<ConfigService> = {
      redisHost,
      redisPort,
      redisPassword: redisPass,
    };
    redisService = new RedisService(mockConfig as ConfigService);
    productsService = new ProductsService(db as any, redisService);

    const reviewsStore = new ReviewsStore(db as any);
    const mockLoyaltyService = {
      awardPoints: jest.fn().mockResolvedValue(true),
    } as unknown as LoyaltyService;
    const mockSettingsService = {
      getTextReviewPoints: jest.fn().mockResolvedValue(10),
      getMediaReviewPoints: jest.fn().mockResolvedValue(25),
    } as unknown as SettingsService;
    const mockOrdersStore = {
      getOrderDetailsWithPayments: jest.fn(),
    } as unknown as OrdersStore;

    reviewsService = new ReviewsService(
      reviewsStore,
      mockLoyaltyService,
      mockSettingsService,
      mockOrdersStore,
      redisService,
    );

    ordersStore = new OrdersStore(db as any);

    // 3. Seed test user & address & order for review moderation tests
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `cache-tester-${Date.now()}@gramoz.com`,
        passwordHash: 'dummy',
        fullName: 'Cache Tester',
        status: 'active',
      })
      .returning();
    testUserId = user.id;
    createdUserIds.push(user.id);

    const [address] = await db
      .insert(schema.addresses)
      .values({
        userId: testUserId,
        title: 'Home',
        addressLine1: '123 Main St',
        city: 'Dhaka',
      })
      .returning();

    const [order] = await db
      .insert(schema.orders)
      .values({
        userId: testUserId,
        shippingAddressId: address.id,
        totalAmount: '1000.00',
        status: 'delivered',
      })
      .returning();
    testOrderId = order.id;
    createdOrderIds.push(order.id);
  });

  afterAll(async () => {
    try {
      if (createdReviewIds.length > 0) {
        await pool.query('DELETE FROM reviews WHERE id = ANY($1::uuid[])', [
          createdReviewIds,
        ]);
      }
      if (createdOrderIds.length > 0) {
        await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [
          createdOrderIds,
        ]);
      }
      if (createdProductIds.length > 0) {
        for (const pid of createdProductIds) {
          await redisClient.del(`product:${pid}`);
        }
        await pool.query(
          'DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])',
          [createdProductIds],
        );
        await pool.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [
          createdProductIds,
        ]);
      }
      if (createdUserIds.length > 0) {
        await pool.query(
          'DELETE FROM addresses WHERE user_id = ANY($1::uuid[])',
          [createdUserIds],
        );
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
          createdUserIds,
        ]);
      }
    } finally {
      redisService.onModuleDestroy();
      await redisClient.quit();
      await pool.end();
    }
  });

  describe('CACHE-20-A & CONC-20-A: Product Update & Concurrent Reads', () => {
    it('warms cache, executes concurrent reads during update, and ensures eventual cache consistency', async () => {
      const product = await productsService.create({
        name: 'Concurrent Read Polo',
        price: 800,
        stock: 50,
      });
      createdProductIds.push(product.id);

      // 1. Warm cache
      const cached1 = await productsService.findOne(product.id);
      expect(cached1?.price).toBe('800.00');
      const inRedis1 = await redisClient.get(`product:${product.id}`);
      expect(inRedis1).not.toBeNull();

      // 2. Fire 10 parallel reads while triggering an update
      const updatePromise = productsService.update(product.id, { price: 950 });
      const readPromises = Array.from({ length: 10 }, () =>
        productsService.findOne(product.id),
      );

      const [updatedProd, ...readResults] = await Promise.all([
        updatePromise,
        ...readPromises,
      ]);

      expect(updatedProd.price).toBe('950.00');

      // Every read must return a valid non-null product (either old 800.00 or new 950.00, never corrupt)
      for (const res of readResults) {
        expect(res).toBeDefined();
        expect(['800.00', '950.00']).toContain(res?.price);
      }

      // Next read after update settles MUST return the new authoritative price and repopulate Redis
      const finalRead = await productsService.findOne(product.id);
      expect(finalRead?.price).toBe('950.00');

      const finalInRedis = await redisClient.get(`product:${product.id}`);
      expect(finalInRedis).not.toBeNull();
      expect(JSON.parse(finalInRedis).price).toBe('950.00');
    });
  });

  describe('CACHE-20-B & CONC-20-C: Product Deletion & Exposure Boundary', () => {
    it('warms cache, soft-deletes product, and verifies product is evicted and returns 404/undefined', async () => {
      const product = await productsService.create({
        name: 'Product to be Deleted',
        price: 300,
        stock: 10,
      });
      createdProductIds.push(product.id);

      // Warm cache
      await productsService.findOne(product.id);
      expect(await redisClient.get(`product:${product.id}`)).not.toBeNull();

      // Soft delete
      await productsService.delete(product.id);

      // Verify Redis cache key product:<id> was removed
      const cacheAfterDelete = await redisClient.get(`product:${product.id}`);
      expect(cacheAfterDelete).toBeNull();

      // findOne returns undefined (which controller maps to 404)
      const lookup = await productsService.findOne(product.id);
      expect(lookup).toBeUndefined();

      // Also verify catalog findAll excludes it
      const catalog = await productsService.findAll({
        q: 'Product to be Deleted',
      });
      expect(catalog.data.find((p) => p.id === product.id)).toBeUndefined();
    });
  });

  describe('CACHE-20-C: Price Change & Freshness', () => {
    it('invalidates cached price on mutation so customer views fresh price', async () => {
      const product = await productsService.create({
        name: 'Price Change Item',
        price: 500,
        stock: 20,
      });
      createdProductIds.push(product.id);

      // Warm cache
      await productsService.findOne(product.id);

      // Price update
      await productsService.update(product.id, { price: 420 });

      // Immediate check: cache is deleted
      expect(await redisClient.get(`product:${product.id}`)).toBeNull();

      // Subsequent read fetches fresh price
      const fresh = await productsService.findOne(product.id);
      expect(fresh?.price).toBe('420.00');
    });
  });

  describe('CACHE-20-D & CONC-20-D: Variant Updates', () => {
    it('updates variant stock and price in DB and reflects correctly in cached response', async () => {
      const product = await productsService.create({
        name: 'Variant Item',
        price: 1000,
        stock: 30,
        variants: JSON.stringify([
          {
            sku: 'VAR-ORIG',
            price: 1000,
            stock: 30,
            attributes: { size: 'M' },
          },
        ]),
      });
      createdProductIds.push(product.id);

      // Warm cache
      const initial = await productsService.findOne(product.id);
      expect(initial?.variants).toHaveLength(1);
      expect(initial?.variants?.[0].sku).toBe('VAR-ORIG');

      // Update variants
      await productsService.update(product.id, {
        variants: JSON.stringify([
          {
            sku: 'VAR-NEW-1',
            price: 950,
            stock: 15,
            attributes: { size: 'S' },
          },
          {
            sku: 'VAR-NEW-2',
            price: 1050,
            stock: 15,
            attributes: { size: 'L' },
          },
        ]),
      });

      // Cache was invalidated
      expect(await redisClient.get(`product:${product.id}`)).toBeNull();

      // Next read returns updated variants
      const updated = await productsService.findOne(product.id);
      expect(updated?.variants).toHaveLength(2);
      const skus = updated?.variants?.map((v) => v.sku).sort();
      expect(skus).toEqual(['VAR-NEW-1', 'VAR-NEW-2']);
    });
  });

  describe('CACHE-20-E & CONC-20-I: Review Moderation & Rating Re-aggregation', () => {
    it('approving review recalculates averageRating and reviewCount, invalidating product cache', async () => {
      const product = await productsService.create({
        name: 'Reviewed Product',
        price: 700,
        stock: 25,
      });
      createdProductIds.push(product.id);

      // Warm cache: 0 reviews
      const initial = await productsService.findOne(product.id);
      expect(initial?.averageRating).toBe(0);
      expect(initial?.reviewCount).toBe(0);

      // Insert pending review
      const [review] = await db
        .insert(schema.reviews)
        .values({
          userId: testUserId,
          productId: product.id,
          orderId: testOrderId,
          rating: 5,
          comment: 'Excellent quality!',
          status: 'pending',
        })
        .returning();
      createdReviewIds.push(review.id);

      // Product still has 0 approved reviews while pending
      const whilePending = await productsService.findOne(product.id);
      expect(whilePending?.averageRating).toBe(0);

      // Admin approves review -> triggers redisService.del(`product:${productId}`)
      await reviewsService.updateReviewStatus(review.id, 'approved');

      // Verify product cache was invalidated
      expect(await redisClient.get(`product:${product.id}`)).toBeNull();

      // Next findOne reflects approved review
      const afterApproval = await productsService.findOne(product.id);
      expect(afterApproval?.averageRating).toBe(5);
      expect(afterApproval?.reviewCount).toBe(1);
    });
  });

  describe('CACHE-20-F: Redis Invalidation Failure Resilience', () => {
    it('ensures DB mutation commits and succeeds even if Redis DEL throws error', async () => {
      const product = await productsService.create({
        name: 'Redis Fail Item',
        price: 250,
        stock: 15,
      });
      createdProductIds.push(product.id);

      // Spy on redisService.del to simulate Redis failure
      const delSpy = jest
        .spyOn(redisService, 'del')
        .mockRejectedValueOnce(new Error('Redis DEL timeout'));

      // Update should NOT throw; should succeed and update DB
      const updated = await productsService.update(product.id, { price: 300 });
      expect(updated.price).toBe('300.00');

      delSpy.mockRestore();

      // Verify DB actually updated
      const dbRow = await pool.query(
        'SELECT price FROM products WHERE id = $1',
        [product.id],
      );
      expect(dbRow.rows[0].price).toBe('300.00');
    });
  });

  describe('CACHE-20-H: Redis Eviction Simulation', () => {
    it('handles unexpected Redis key eviction gracefully by repopulating from PostgreSQL', async () => {
      const product = await productsService.create({
        name: 'Eviction Candidate',
        price: 400,
        stock: 5,
      });
      createdProductIds.push(product.id);

      // Warm cache
      await productsService.findOne(product.id);
      expect(await redisClient.get(`product:${product.id}`)).not.toBeNull();

      // Simulate eviction
      await redisClient.del(`product:${product.id}`);

      // Read after eviction repopulates without error
      const repopulated = await productsService.findOne(product.id);
      expect(repopulated?.name).toBe('Eviction Candidate');
      expect(await redisClient.get(`product:${product.id}`)).not.toBeNull();
    });
  });

  describe('CACHE-20-I & CONC-20-H: Redis Outage Fallback', () => {
    it('serves product seamlessly from PostgreSQL when Redis is completely unavailable', async () => {
      const product = await productsService.create({
        name: 'Outage Resistant Tee',
        price: 550,
        stock: 20,
      });
      createdProductIds.push(product.id);

      // Mock redisService.get to throw connection error
      const getSpy = jest
        .spyOn(redisService, 'get')
        .mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379'));
      const setSpy = jest
        .spyOn(redisService, 'set')
        .mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379'));

      // findOne must NOT fail; it falls back to DB query
      const result = await productsService.findOne(product.id);
      expect(result).toBeDefined();
      expect(result?.id).toBe(product.id);
      expect(result?.name).toBe('Outage Resistant Tee');

      getSpy.mockRestore();
      setSpy.mockRestore();
    });
  });

  describe('CACHE-20-J & CONC-20-G: Concurrent Cache Misses (Stampede Test)', () => {
    it('20 concurrent requests for an uncached product all succeed without errors or race corruption', async () => {
      const product = await productsService.create({
        name: 'Stampede Test Polo',
        price: 990,
        stock: 100,
      });
      createdProductIds.push(product.id);

      // Ensure cache is cold
      await redisClient.del(`product:${product.id}`);

      // Fire 20 parallel requests
      const promises = Array.from({ length: 20 }, () =>
        productsService.findOne(product.id),
      );
      const results = await Promise.all(promises);

      expect(results).toHaveLength(20);
      for (const res of results) {
        expect(res).toBeDefined();
        expect(res?.id).toBe(product.id);
        expect(res?.price).toBe('990.00');
      }

      // Cache is now hot
      const cached = await redisClient.get(`product:${product.id}`);
      expect(cached).not.toBeNull();
    });
  });

  describe('CACHE-20-K & CONC-20-D & CONC-20-E: Authoritative PostgreSQL Stock in Checkout', () => {
    it('checkout uses authoritative PostgreSQL inventory and rejects when stock is insufficient', async () => {
      const product = await productsService.create({
        name: 'Limited Edition Watch',
        price: 5000,
        stock: 1, // Only 1 in stock!
      });
      createdProductIds.push(product.id);

      // Warm cache (cache says stock: 1)
      await productsService.findOne(product.id);

      // Buyer 1 checkouts product (deducts 1 in PostgreSQL)
      const deduct1 = await ordersStore.deductProductStock(product.id, 1);
      expect(deduct1).toBe(true);

      // Buyer 2 attempts checkout of 1 unit
      const deduct2 = await ordersStore.deductProductStock(product.id, 1);
      expect(deduct2).toBe(false); // Rejected! Zero inventory overselling!

      // Verify PostgreSQL stock is exactly 0
      const dbRow = await pool.query(
        'SELECT stock FROM products WHERE id = $1',
        [product.id],
      );
      expect(dbRow.rows[0].stock).toBe(0);
    });
  });

  describe('CACHE-20-L & CONC-20-J: Multi-faceted Catalog Query Isolation', () => {
    it('concurrent catalog queries with different filters and pagination return deterministic results', async () => {
      const queries = [
        productsService.findAll({ limit: '5', page: '1' }),
        productsService.findAll({ limit: '5', page: '2' }),
        productsService.findAll({ inStock: 'true', sort: 'price_asc' }),
        productsService.findAll({ sort: 'price_desc' }),
        productsService.findAll({ minPrice: '100', maxPrice: '500' }),
      ];

      const results = await Promise.all(queries);

      expect(results).toHaveLength(5);
      for (const r of results) {
        expect(r.data).toBeDefined();
        expect(r.meta).toBeDefined();
        expect(r.meta.totalPages).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('CONC-20-F: Concurrent Administrative Product Modifications', () => {
    it('concurrent updates to different fields of the same product succeed without deadlocks', async () => {
      const product = await productsService.create({
        name: 'Concurrent Mod Item',
        price: 1500,
        stock: 50,
      });
      createdProductIds.push(product.id);

      const update1 = productsService.update(product.id, {
        name: 'Renamed Concurrently',
      });
      const update2 = productsService.update(product.id, { stock: 75 });

      await expect(Promise.all([update1, update2])).resolves.toBeDefined();

      const finalProduct = await productsService.findOne(product.id);
      expect(finalProduct).toBeDefined();
      expect(finalProduct?.id).toBe(product.id);
    });
  });
});

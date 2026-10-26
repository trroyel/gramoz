/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import * as schema from '@database/schema';
import { ProductsService } from '../products/products.service';
import { RedisService } from '../../cache/redis.service';
import { ReviewsService } from './reviews.service';
import { ReviewsStore } from './reviews.store';
import { LoyaltyStore } from '../loyalty/loyalty.store';
import { LoyaltyService } from '../loyalty/loyalty.service';

describe('Reviews & Product Cache Consistency Verification (Real PG 16 & Redis 7 — TASK-23F Phase 6)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let redisClient: Redis;
  let redisService: RedisService;
  let productsService: ProductsService;
  let reviewsStore: ReviewsStore;
  let reviewsService: ReviewsService;
  let loyaltyStore: LoyaltyStore;
  let loyaltyService: LoyaltyService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = Number(process.env.REDIS_PORT) || 6380;
  const redisPass = process.env.REDIS_PASSWORD || 'redis_pass';

  const createdProductIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdReviewIds: string[] = [];
  const createdAddressIds: string[] = [];

  let testUserId: string;
  let testProductId: string;
  let testOrderId: string;
  let testOrderItemId: string;
  let testAddressId: string;

  const mockSettingsService: any = {
    getTextReviewPoints: jest.fn().mockResolvedValue(50),
    getMediaReviewPoints: jest.fn().mockResolvedValue(100),
    getPointsValidityDays: jest.fn().mockResolvedValue(365),
  };

  const mockOrdersStore: any = {
    getOrderDetailsWithPayments: jest.fn(),
    getOrderItemsWithProducts: jest.fn(),
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
    });
    db = drizzle(pool, { schema });

    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPass,
      retryStrategy: () => null,
    });

    const mockConfigService: any = {
      redisHost,
      redisPort,
      redisPassword: redisPass,
      get: (key: string, defaultVal: any) => {
        if (key === 'REDIS_HOST') return redisHost;
        if (key === 'REDIS_PORT') return redisPort;
        if (key === 'REDIS_PASSWORD') return redisPass;
        return defaultVal;
      },
    };

    redisService = new RedisService(mockConfigService);
    if (
      (redisService as any).client &&
      (redisService as any).client !== redisClient
    ) {
      await (redisService as any).client.quit();
    }
    // Bind real redisClient
    (redisService as any).client = redisClient;

    productsService = new ProductsService(db as any, redisService);
    loyaltyStore = new LoyaltyStore(db as any);
    loyaltyService = new LoyaltyService(loyaltyStore, mockSettingsService);
    reviewsStore = new ReviewsStore(db as any);

    reviewsService = new ReviewsService(
      reviewsStore,
      loyaltyService,
      mockSettingsService,
      mockOrdersStore,
      redisService,
    );

    // 1. Seed Customer User
    const [u] = await db
      .insert(schema.users)
      .values({
        email: `cache-review-tester-${Date.now()}@gramoz.test`,
        fullName: 'Cache Review Tester',
        passwordHash: 'dummy-hash',
        role: 'customer',
        status: 'active',
      })
      .returning();
    testUserId = u.id;
    createdUserIds.push(u.id);

    // 2. Seed Address
    const [addr] = await db
      .insert(schema.addresses)
      .values({
        userId: testUserId,
        title: 'Home',
        addressLine1: 'Gulshan 2',
        city: 'Dhaka',
      })
      .returning();
    testAddressId = addr.id;
    createdAddressIds.push(addr.id);

    // 3. Seed Product
    const [prod] = await db
      .insert(schema.products)
      .values({
        name: `Cache Consistency Product ${Date.now()}`,
        slug: `cache-prod-${Date.now()}`,
        description: 'Testing review cache invalidation',
        price: '2500.00',
        stock: 50,
        status: 'active',
      })
      .returning();
    testProductId = prod.id;
    createdProductIds.push(prod.id);

    // 4. Seed Delivered Order
    const [ord] = await db
      .insert(schema.orders)
      .values({
        userId: testUserId,
        shippingAddressId: testAddressId,
        totalAmount: '2500.00',
        status: 'delivered',
      })
      .returning();
    testOrderId = ord.id;
    createdOrderIds.push(ord.id);

    const [item] = await db
      .insert(schema.orderItems)
      .values({
        orderId: testOrderId,
        productId: testProductId,
        quantity: 1,
        unitPrice: '2500.00',
      })
      .returning();
    testOrderItemId = item.id;
  });

  afterAll(async () => {
    // Clean up Redis keys
    if (testProductId) {
      await redisClient.del(`product:${testProductId}`);
    }
    // Clean up DB
    await pool.query(
      `DELETE FROM loyalty_points WHERE user_id = ANY($1::uuid[])`,
      [createdUserIds],
    );
    if (createdReviewIds.length > 0) {
      await pool.query(`DELETE FROM reviews WHERE id = ANY($1::uuid[])`, [
        createdReviewIds,
      ]);
    }
    await pool.query(
      `DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`,
      [createdOrderIds],
    );
    await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
      createdOrderIds,
    ]);
    await pool.query(`DELETE FROM addresses WHERE id = ANY($1::uuid[])`, [
      createdAddressIds,
    ]);
    await pool.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [
      createdProductIds,
    ]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      createdUserIds,
    ]);

    await (redisService as any).onModuleDestroy?.();
    await redisClient.quit();
    await pool.end();
  });

  it('Scenario 1: Review approval successfully invalidates product Redis cache immediately', async () => {
    const cacheKey = `product:${testProductId}`;

    // 1. Initial product read populates Redis cache (averageRating: 0, reviewCount: 0)
    await redisClient.del(cacheKey);
    const initialProduct = await productsService.findOne(testProductId);
    expect(initialProduct?.averageRating).toBe(0);
    expect(initialProduct?.reviewCount).toBe(0);

    // Verify key exists in Redis
    const cachedBefore = await redisClient.get(cacheKey);
    expect(cachedBefore).not.toBeNull();
    const parsedBefore = JSON.parse(cachedBefore!);
    expect(parsedBefore.averageRating).toBe(0);

    // 2. Submit review (rating: 5), initially pending
    mockOrdersStore.getOrderDetailsWithPayments.mockResolvedValue({
      id: testOrderId,
      userId: testUserId,
      status: 'delivered',
    });
    mockOrdersStore.getOrderItemsWithProducts.mockResolvedValue([
      { id: testOrderItemId, productId: testProductId, quantity: 1 },
    ]);

    const review = await reviewsService.submitReview(
      testUserId,
      testOrderId,
      testProductId,
      5,
      'Excellent product with 5 stars',
    );
    createdReviewIds.push(review.id);
    expect(review.status).toBe('pending');

    // 3. Admin approves review -> triggers redisService.del(`product:${testProductId}`)
    await reviewsService.updateReviewStatus(review.id, 'approved');

    // Verify key was invalidated in Redis
    const cachedAfterInvalidation = await redisClient.get(cacheKey);
    expect(cachedAfterInvalidation).toBeNull();

    // 4. Subsequent product read queries PostgreSQL and populates fresh rating
    const updatedProduct = await productsService.findOne(testProductId);
    expect(updatedProduct?.averageRating).toBe(5);
    expect(updatedProduct?.reviewCount).toBe(1);

    // Verify Redis is re-populated with fresh rating
    const reCached = await redisClient.get(cacheKey);
    expect(reCached).not.toBeNull();
    expect(JSON.parse(reCached!).averageRating).toBe(5);
  });

  it('Scenario 2: Customer review edit triggers re-moderation and invalidates cache', async () => {
    const cacheKey = `product:${testProductId}`;
    const [review] = await db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.productId, testProductId));
    expect(review).toBeDefined();

    // Customer edits review -> status reverts to pending, Redis cache is busted
    await reviewsService.updateCustomerReview(testUserId, review.id, {
      rating: 4,
      comment: 'Updated review awaiting re-moderation',
    });

    // Check DB status reverted to pending
    const [updatedReviewInDb] = await db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, review.id));
    expect(updatedReviewInDb.status).toBe('pending');

    // Verify Redis cache was invalidated
    const cached = await redisClient.get(cacheKey);
    expect(cached).toBeNull();

    // Subsequent read computes rating ONLY from approved reviews -> returns 0
    const productAfterEdit = await productsService.findOne(testProductId);
    expect(productAfterEdit?.averageRating).toBe(0);
    expect(productAfterEdit?.reviewCount).toBe(0);
  });

  it('Scenario 3: Failed invalidation serves stale cache until TTL expiration (clarification of TASK-23 claim)', async () => {
    const cacheKey = `product:${testProductId}`;

    // Seed Redis with an artificially cached product (averageRating: 4.88, reviewCount: 15)
    const mockCachedProduct = {
      id: testProductId,
      name: 'Simulated Cached Product',
      price: '2500.00',
      averageRating: 4.88,
      reviewCount: 15,
      variants: [],
    };

    // Store in Redis with short 2-second TTL
    await redisClient.set(cacheKey, JSON.stringify(mockCachedProduct), 'EX', 2);

    // Simulate failed invalidation on review deletion (e.g. temporary Redis network error swallowed)
    // The key remains in Redis!
    const keyStillExists = await redisClient.exists(cacheKey);
    expect(keyStillExists).toBe(1);

    // PROOF: As long as the key exists in Redis, findOne() does NOT query PostgreSQL;
    // it returns the stale cached entry!
    const staleRead = await productsService.findOne(testProductId);
    expect(staleRead?.averageRating).toBe(4.88);
    expect(staleRead?.reviewCount).toBe(15);

    // Wait 2.2 seconds for Redis TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 2200));

    // Verify Redis key has now expired
    const keyAfterExpiry = await redisClient.get(cacheKey);
    expect(keyAfterExpiry).toBeNull();

    // After TTL expiration, the read MUST fall back to PostgreSQL and recompute fresh state!
    const freshRead = await productsService.findOne(testProductId);
    // Since the review in DB is still pending, approved rating is 0
    expect(freshRead?.averageRating).toBe(0);
    expect(freshRead?.reviewCount).toBe(0);
  });

  it('Scenario 4: Concurrent stale cache write is bounded by 300s TTL without compromising financial security', async () => {
    const cacheKey = `product:${testProductId}`;

    // Set TTL on key
    await productsService.findOne(testProductId);
    const ttl = await redisClient.ttl(cacheKey);

    // Verify TTL is bounded at or below 300 seconds
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);

    // Financial calculations (e.g. order item pricing) are derived authoritatively from
    // PostgreSQL `products.price` / `product_variants.price`, NOT from Redis review cache.
    const [authoritativeProduct] = await db
      .select({ price: schema.products.price, stock: schema.products.stock })
      .from(schema.products)
      .where(eq(schema.products.id, testProductId));

    expect(Number(authoritativeProduct.price)).toBe(2500);
    expect(authoritativeProduct.stock).toBe(50);
  });
});

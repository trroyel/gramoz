/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inArray, sql } from 'drizzle-orm';
import * as schema from '@database/schema';
import { ReviewsStore } from './reviews.store';
import { ReviewsService } from './reviews.service';
import { LoyaltyStore } from '../loyalty/loyalty.store';
import { LoyaltyService } from '../loyalty/loyalty.service';

describe('Reviews PostgreSQL Indexing, Aggregation & Concurrency (Real PostgreSQL 16 — TASK-11b / TASK-23)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let reviewsStore: ReviewsStore;
  let reviewsService: ReviewsService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  let testUserId1: string;
  let testUserId2: string;
  let testUserId3: string;
  let testAddressId: string;
  let testProductId: string;
  let testOrderId1: string;
  let testOrderId2: string;
  let testOrderId3: string;

  const createdReviewIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdUserIds: string[] = [];

  const mockRedisService: any = {
    del: jest.fn().mockResolvedValue(1),
  };

  const mockLoyaltyService: any = {
    awardPoints: jest.fn().mockResolvedValue(true),
  };

  const mockSettingsService: any = {
    getTextReviewPoints: jest.fn().mockResolvedValue(10),
    getMediaReviewPoints: jest.fn().mockResolvedValue(25),
    getPointsValidityDays: jest.fn().mockResolvedValue(30),
  };

  const mockOrdersStore: any = {
    getOrderDetailsWithPayments: jest.fn(),
    getOrderItemsWithProducts: jest.fn(),
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 10,
    });
    db = drizzle(pool, { schema });
    reviewsStore = new ReviewsStore(db as any);
    reviewsService = new ReviewsService(
      reviewsStore,
      mockLoyaltyService,
      mockSettingsService,
      mockOrdersStore,
      mockRedisService,
    );

    // Create 3 test users
    const [u1] = await db
      .insert(schema.users)
      .values({
        email: `rev-test1-${Date.now()}@test.gramoz.com`,
        passwordHash: 'dummy',
        fullName: 'Review Tester 1',
        status: 'active',
      })
      .returning();
    testUserId1 = u1.id;
    createdUserIds.push(u1.id);

    const [u2] = await db
      .insert(schema.users)
      .values({
        email: `rev-test2-${Date.now()}@test.gramoz.com`,
        passwordHash: 'dummy',
        fullName: 'Review Tester 2',
        status: 'active',
      })
      .returning();
    testUserId2 = u2.id;
    createdUserIds.push(u2.id);

    const [u3] = await db
      .insert(schema.users)
      .values({
        email: `rev-test3-${Date.now()}@test.gramoz.com`,
        passwordHash: 'dummy',
        fullName: 'Review Tester 3',
        status: 'active',
      })
      .returning();
    testUserId3 = u3.id;
    createdUserIds.push(u3.id);

    // Create 1 test address
    const [addr] = await db
      .insert(schema.addresses)
      .values({
        userId: testUserId1,
        title: 'Review Test Address',
        addressLine1: 'Road 12, Banani',
        city: 'Dhaka',
      })
      .returning();
    testAddressId = addr.id;
    createdAddressIds.push(addr.id);

    // Create 1 test product
    const [prod] = await db
      .insert(schema.products)
      .values({
        name: `Review Target Product ${Date.now()}`,
        slug: `rev-target-prod-${Date.now()}`,
        description: 'Target for reviews performance test',
        price: '450.00',
        stock: 50,
        status: 'active',
      })
      .returning();
    testProductId = prod.id;
    createdProductIds.push(prod.id);

    // Create delivered orders for each user
    const [o1] = await db
      .insert(schema.orders)
      .values({
        userId: testUserId1,
        totalAmount: '450.00',
        status: 'delivered',
        shippingAddressId: testAddressId,
      })
      .returning();
    testOrderId1 = o1.id;
    createdOrderIds.push(o1.id);

    const [o2] = await db
      .insert(schema.orders)
      .values({
        userId: testUserId2,
        totalAmount: '450.00',
        status: 'delivered',
        shippingAddressId: testAddressId,
      })
      .returning();
    testOrderId2 = o2.id;
    createdOrderIds.push(o2.id);

    const [o3] = await db
      .insert(schema.orders)
      .values({
        userId: testUserId3,
        totalAmount: '450.00',
        status: 'delivered',
        shippingAddressId: testAddressId,
      })
      .returning();
    testOrderId3 = o3.id;
    createdOrderIds.push(o3.id);
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    if (createdReviewIds.length > 0) {
      await db
        .delete(schema.reviews)
        .where(inArray(schema.reviews.id, createdReviewIds));
    }
    if (createdOrderIds.length > 0) {
      await db
        .delete(schema.orders)
        .where(inArray(schema.orders.id, createdOrderIds));
    }
    if (createdAddressIds.length > 0) {
      await db
        .delete(schema.addresses)
        .where(inArray(schema.addresses.id, createdAddressIds));
    }
    if (createdProductIds.length > 0) {
      await db
        .delete(schema.products)
        .where(inArray(schema.products.id, createdProductIds));
    }
    if (createdUserIds.length > 0) {
      await db
        .delete(schema.users)
        .where(inArray(schema.users.id, createdUserIds));
    }
    await pool.end();
  });

  describe('PostgreSQL Schema & Partial Index Verification', () => {
    it('verifies idx_reviews_product_approved_rating exists with partial status constraint', async () => {
      const result = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'reviews'
          AND indexname = 'idx_reviews_product_approved_rating';
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].indexdef).toContain('product_id');
      expect(result.rows[0].indexdef).toContain('rating');
      expect(result.rows[0].indexdef).toContain("status = 'approved'");
    });

    it('verifies idx_reviews_product_approved_created exists with partial status constraint', async () => {
      const result = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'reviews'
          AND indexname = 'idx_reviews_product_approved_created';
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].indexdef).toContain('product_id');
      expect(result.rows[0].indexdef).toContain('created_at DESC');
      expect(result.rows[0].indexdef).toContain("status = 'approved'");
    });

    it('verifies idx_reviews_status_created_at exists for admin moderation', async () => {
      const result = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'reviews'
          AND indexname = 'idx_reviews_status_created_at';
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].indexdef).toContain('status');
      expect(result.rows[0].indexdef).toContain('created_at DESC');
    });
  });

  describe('Dynamic Rating Aggregation & Moderation Correctness', () => {
    it('returns averageRating = 0 and reviewCount = 0 when product has zero reviews', async () => {
      const stats = await reviewsStore.getProductReviewStats(testProductId);
      expect(stats.averageRating).toBe(0);
      expect(stats.reviewCount).toBe(0);

      const reviews = await reviewsStore.getProductReviews(testProductId);
      expect(reviews.length).toBe(0);
    });

    it('excludes pending reviews from public ratings and public reviews listing', async () => {
      const [pendingRev] = await db
        .insert(schema.reviews)
        .values({
          userId: testUserId1,
          productId: testProductId,
          orderId: testOrderId1,
          rating: 5,
          comment: 'Pending review should not be public yet',
          status: 'pending',
        })
        .returning();
      createdReviewIds.push(pendingRev.id);

      const stats = await reviewsStore.getProductReviewStats(testProductId);
      expect(stats.averageRating).toBe(0);
      expect(stats.reviewCount).toBe(0);

      const publicReviews = await reviewsStore.getProductReviews(testProductId);
      expect(publicReviews.length).toBe(0);
    });

    it('includes review in public ratings once approved and busts Redis cache', async () => {
      const pendingId = createdReviewIds[createdReviewIds.length - 1];

      await reviewsService.updateReviewStatus(pendingId, 'approved');

      expect(mockRedisService.del).toHaveBeenCalledWith(
        `product:${testProductId}`,
      );

      const stats = await reviewsStore.getProductReviewStats(testProductId);
      expect(stats.averageRating).toBe(5);
      expect(stats.reviewCount).toBe(1);

      const publicReviews = await reviewsStore.getProductReviews(testProductId);
      expect(publicReviews.length).toBe(1);
      expect(publicReviews[0].id).toBe(pendingId);
    });

    it('accurately computes 2-decimal rounded average rating across multiple reviews (e.g. 5, 4, 4 -> 4.33)', async () => {
      // Insert 2 more approved reviews
      const [rev2] = await db
        .insert(schema.reviews)
        .values({
          userId: testUserId2,
          productId: testProductId,
          orderId: testOrderId2,
          rating: 4,
          comment: 'Second review - 4 stars',
          status: 'approved',
        })
        .returning();
      createdReviewIds.push(rev2.id);

      const [rev3] = await db
        .insert(schema.reviews)
        .values({
          userId: testUserId3,
          productId: testProductId,
          orderId: testOrderId3,
          rating: 4,
          comment: 'Third review - 4 stars',
          status: 'approved',
        })
        .returning();
      createdReviewIds.push(rev3.id);

      // Total rating = 5 + 4 + 4 = 13. 13 / 3 = 4.33333333... -> rounded to 4.33
      const stats = await reviewsStore.getProductReviewStats(testProductId);
      expect(stats.averageRating).toBe(4.33);
      expect(stats.reviewCount).toBe(3);

      // Verify deterministic descending createdAt ordering
      const publicReviews = await reviewsStore.getProductReviews(testProductId);
      expect(publicReviews.length).toBe(3);
      expect(
        new Date(publicReviews[0].createdAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(publicReviews[1].createdAt).getTime());
    });

    it('immediately excludes rejected reviews from aggregate rating and count', async () => {
      // Reject the 3rd review (rev3)
      const rev3Id = createdReviewIds[createdReviewIds.length - 1];
      await reviewsService.updateReviewStatus(rev3Id, 'rejected');

      // Now only 5 and 4 remain approved. Total = 9 / 2 = 4.5
      const stats = await reviewsStore.getProductReviewStats(testProductId);
      expect(stats.averageRating).toBe(4.5);
      expect(stats.reviewCount).toBe(2);

      const publicReviews = await reviewsStore.getProductReviews(testProductId);
      expect(publicReviews.length).toBe(2);
      expect(publicReviews.some((r) => r.id === rev3Id)).toBe(false);
    });

    it('immediately recalculates rating when a review is deleted', async () => {
      // Delete the 2nd review (rev2 with rating 4)
      const rev2Id = createdReviewIds[createdReviewIds.length - 2];
      await reviewsService.deleteReview(rev2Id);

      // Now only the 1st review (rating 5) remains approved
      const stats = await reviewsStore.getProductReviewStats(testProductId);
      expect(stats.averageRating).toBe(5);
      expect(stats.reviewCount).toBe(1);

      const publicReviews = await reviewsStore.getProductReviews(testProductId);
      expect(publicReviews.length).toBe(1);
    });
  });

  describe('PostgreSQL Concurrency & Unique Purchase Review Constraint', () => {
    it('enforces idx_unique_review_per_purchase under concurrent insertion attempts', async () => {
      // Attempt 5 concurrent review submissions for the same user, order, and product
      const attempts = Array.from({ length: 5 }, (_, i) =>
        pool.query(
          `INSERT INTO reviews (id, user_id, product_id, order_id, rating, comment, status)
           VALUES (gen_random_uuid(), $1, $2, $3, 5, $4, 'pending')
           RETURNING id;`,
          [testUserId1, testProductId, testOrderId2, `Concurrent attempt ${i}`],
        ),
      );

      const settled = await Promise.allSettled(attempts);
      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      const rejected = settled.filter((s) => s.status === 'rejected');

      // Exactly 1 insert must succeed; all 4 others must fail with 23505 unique_violation
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);

      if (fulfilled[0].status === 'fulfilled') {
        createdReviewIds.push(fulfilled[0].value.rows[0].id);
      }

      for (const rej of rejected) {
        if (rej.status === 'rejected') {
          const err: any = rej.reason;
          expect(err.code).toBe('23505');
          expect(err.message).toContain('idx_unique_review_per_purchase');
        }
      }
    });
  });

  describe('CONC-23-B: Parallel Reviews by Multiple Eligible Customers', () => {
    it('persists all parallel reviews and computes accurate aggregate rating', async () => {
      // Create a dedicated product
      const [prodB] = await db
        .insert(schema.products)
        .values({
          name: `Parallel Review Product ${Date.now()}`,
          slug: `parallel-rev-${Date.now()}`,
          description: 'Testing parallel customer reviews',
          price: '500.00',
          stock: 20,
          status: 'active',
        })
        .returning();
      createdProductIds.push(prodB.id);

      // Create delivered orders for user 1 and user 2
      const [ord1] = await db
        .insert(schema.orders)
        .values({
          userId: testUserId1,
          totalAmount: '500.00',
          status: 'delivered',
          shippingAddressId: testAddressId,
        })
        .returning();
      createdOrderIds.push(ord1.id);

      const [ord2] = await db
        .insert(schema.orders)
        .values({
          userId: testUserId2,
          totalAmount: '500.00',
          status: 'delivered',
          shippingAddressId: testAddressId,
        })
        .returning();
      createdOrderIds.push(ord2.id);

      // Concurrently submit reviews (ratings: 5 and 3)
      const r1Promise = pool.query(
        `INSERT INTO reviews (id, user_id, product_id, order_id, rating, comment, status)
         VALUES (gen_random_uuid(), $1, $2, $3, 5, 'Parallel 5 stars', 'approved') RETURNING id;`,
        [testUserId1, prodB.id, ord1.id],
      );
      const r2Promise = pool.query(
        `INSERT INTO reviews (id, user_id, product_id, order_id, rating, comment, status)
         VALUES (gen_random_uuid(), $1, $2, $3, 3, 'Parallel 3 stars', 'approved') RETURNING id;`,
        [testUserId2, prodB.id, ord2.id],
      );

      const [res1, res2] = await Promise.all([r1Promise, r2Promise]);
      createdReviewIds.push(res1.rows[0].id, res2.rows[0].id);

      // Aggregate: (5 + 3) / 2 = 4.0
      const stats = await reviewsStore.getProductReviewStats(prodB.id);
      expect(stats.averageRating).toBe(4);
      expect(stats.reviewCount).toBe(2);
    });
  });

  describe('CONC-23-C: Concurrent Moderation State Machine', () => {
    it('handles concurrent moderation updates deterministically without corrupting status', async () => {
      const [rev] = await db
        .insert(schema.reviews)
        .values({
          userId: testUserId3,
          productId: testProductId,
          orderId: testOrderId1,
          rating: 5,
          comment: 'Pending moderation test',
          status: 'pending',
        })
        .returning();
      createdReviewIds.push(rev.id);

      // Concurrently approve and reject
      const modAttempts = [
        reviewsService.updateReviewStatus(rev.id, 'approved'),
        reviewsService.updateReviewStatus(rev.id, 'rejected'),
      ];

      const settled = await Promise.allSettled(modAttempts);
      expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);

      const finalRev = await reviewsStore.getReviewById(rev.id);
      expect(['approved', 'rejected']).toContain(finalRev?.status);
    });
  });

  describe('CONC-23-D: Review Deletion Versus Approval Race', () => {
    it('ensures no phantom aggregate contribution when deletion races with approval', async () => {
      const [rev] = await db
        .insert(schema.reviews)
        .values({
          userId: testUserId2,
          productId: testProductId,
          orderId: testOrderId2,
          rating: 1,
          comment: 'To be deleted or approved',
          status: 'pending',
        })
        .returning();
      createdReviewIds.push(rev.id);

      // Race deleteReview and updateReviewStatus
      const race = [
        reviewsService.deleteReview(rev.id),
        reviewsService.updateReviewStatus(rev.id, 'approved'),
      ];

      await Promise.allSettled(race);

      // Whether deleted or not, if deleted it cannot appear in approved stats
      const finalRev = await reviewsStore.getReviewById(rev.id);
      if (!finalRev) {
        const publicReviews =
          await reviewsStore.getProductReviews(testProductId);
        expect(publicReviews.some((r) => r.id === rev.id)).toBe(false);
      }
    });
  });

  describe('CONC-23-E: Review Update Versus Moderation Reset', () => {
    it('customer edits immediately reset status to pending for re-moderation', async () => {
      // Create approved review
      const [rev] = await db
        .insert(schema.reviews)
        .values({
          userId: testUserId1,
          productId: testProductId,
          orderId: testOrderId3,
          rating: 5,
          comment: 'Original approved comment',
          status: 'approved',
        })
        .returning();
      createdReviewIds.push(rev.id);

      // Customer edits review
      const updated = await reviewsService.updateCustomerReview(
        testUserId1,
        rev.id,
        {
          rating: 4,
          comment: 'Modified comment requiring re-approval',
        },
      );

      // Must be pending!
      expect(updated.status).toBe('pending');
      expect(updated.rating).toBe(4);

      // Public product review stats must exclude pending review
      const publicReviews = await reviewsStore.getProductReviews(testProductId);
      expect(publicReviews.some((r) => r.id === rev.id)).toBe(false);
    });
  });

  describe('CONC-23-F: Product Deletion Versus Review Submission', () => {
    it('enforces foreign key integrity when product does not exist', async () => {
      const nonExistentProductId = '99999999-9999-4999-8999-999999999999';

      await expect(
        pool.query(
          `INSERT INTO reviews (id, user_id, product_id, order_id, rating, comment, status)
           VALUES (gen_random_uuid(), $1, $2, $3, 5, 'Orphan review', 'pending')`,
          [testUserId1, nonExistentProductId, testOrderId1],
        ),
      ).rejects.toThrow(/violates foreign key constraint/);
    });
  });

  describe('CONC-23-G: Review Loyalty Reward Replay Idempotency', () => {
    it('credits loyalty points at most once for identical review referenceId replay', async () => {
      const realLoyaltyStore = new LoyaltyStore(db as any);
      const realLoyaltyService = new LoyaltyService(
        realLoyaltyStore,
        mockSettingsService,
      );

      const reviewId = '77777777-7777-4777-8777-777777777777';

      // First award
      const firstAward = await realLoyaltyService.awardPoints(
        testUserId1,
        10,
        'earned_review_text',
        reviewId,
      );
      expect(firstAward).not.toBeNull();

      // Concurrent replay of the same review reward event (5 times)
      const replays = Array.from({ length: 5 }, () =>
        realLoyaltyService.awardPoints(
          testUserId1,
          10,
          'earned_review_text',
          reviewId,
        ),
      );

      const replayResults = await Promise.all(replays);
      // All replays must return null (idempotent early return)
      expect(replayResults.every((r) => r === null)).toBe(true);

      // Check database: exactly 1 loyalty point record exists for this referenceId
      const countRes = await pool.query(
        `SELECT count(*)::int as count FROM loyalty_points WHERE reference_id = $1`,
        [reviewId],
      );
      expect(countRes.rows[0].count).toBe(1);

      // Cleanup
      await pool.query(`DELETE FROM loyalty_points WHERE reference_id = $1`, [
        reviewId,
      ]);
    });
  });

  describe('EXPLAIN Plan Verification for Partial Index Utilization', () => {
    it('utilizes partial index for rating aggregation without sequential table scan', async () => {
      // In this test product we have 1 approved review and 1 pending review.
      // In PostgreSQL, to encourage index scans over sequential scans on small tables during testing,
      // enable enable_seqscan = off in this session.
      await pool.query('SET enable_seqscan = off;');
      try {
        const explainRes = await pool.query(
          `EXPLAIN (ANALYZE, BUFFERS)
           SELECT
             COALESCE(ROUND(AVG(rating)::numeric, 2), 0)::float as "averageRating",
             COUNT(*)::int as "reviewCount"
           FROM reviews
           WHERE product_id = $1 AND status = 'approved'`,
          [testProductId],
        );

        const planText = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');

        // Verify partial index is picked
        expect(planText).toMatch(
          /idx_reviews_product_approved_(rating|created)/,
        );
        expect(planText).not.toMatch(/Seq Scan on reviews/);
      } finally {
        await pool.query('SET enable_seqscan = on;');
      }
    });
  });
});

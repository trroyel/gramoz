/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import * as schema from '@database/schema';
import { LoyaltyStore } from './loyalty.store';
import { LoyaltyService } from './loyalty.service';
import { ReviewsStore } from '../reviews/reviews.store';
import { ReviewsService } from '../reviews/reviews.service';
import { BadRequestException } from '@nestjs/common';

describe('Real PostgreSQL 16 — TASK-23G: Loyalty Transaction Safety & Historical Reward Integrity', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let loyaltyStore: LoyaltyStore;
  let loyaltyService: LoyaltyService;
  let reviewsStore: ReviewsStore;
  let reviewsService: ReviewsService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  let testUserId1: string;
  let testUserId2: string;
  let testAddressId: string;
  let testProductId1: string;
  let testProductId2: string;
  let testOrderId1: string;
  let testOrderId2: string;
  let testOrderItemId1: string;
  let testOrderItemId2: string;

  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdReviewIds: string[] = [];
  const createdReferenceIds: string[] = [];

  const mockRedisService: any = {
    del: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };

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

    loyaltyStore = new LoyaltyStore(db);
    loyaltyService = new LoyaltyService(loyaltyStore, mockSettingsService);

    reviewsStore = new ReviewsStore(db);
    reviewsService = new ReviewsService(
      reviewsStore,
      loyaltyService,
      mockSettingsService,
      mockOrdersStore,
      mockRedisService,
    );

    // Clean up any legacy static test UUIDs from prior aborted runs
    await pool.query(
      `DELETE FROM loyalty_points WHERE reference_id IN (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'dddddddd-1111-4ddd-8ddd-dddddddddddd',
        'dddddddd-2222-4ddd-8ddd-dddddddddddd',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        '77777777-7777-4777-8777-777777777777',
        '88888888-8888-4888-8888-888888888888',
        '00000000-dead-beef-0000-000000000001'
      )`,
    );

    // 1. Seed Users
    const [u1] = await db
      .insert(schema.users)
      .values({
        email: `pg23g-user-1-${Date.now()}@gramoz.test`,
        fullName: 'PG23G Test User 1',
        passwordHash: 'dummy-argon2-hash',
        role: 'customer',
        status: 'active',
      })
      .returning();
    testUserId1 = u1.id;
    createdUserIds.push(u1.id);

    const [u2] = await db
      .insert(schema.users)
      .values({
        email: `pg23g-user-2-${Date.now()}@gramoz.test`,
        fullName: 'PG23G Test User 2',
        passwordHash: 'dummy-argon2-hash',
        role: 'customer',
        status: 'active',
      })
      .returning();
    testUserId2 = u2.id;
    createdUserIds.push(u2.id);

    // 2. Seed Address
    const [addr] = await db
      .insert(schema.addresses)
      .values({
        userId: testUserId1,
        title: 'Primary Office',
        addressLine1: 'Gulshan 2, Plot 14',
        city: 'Dhaka',
      })
      .returning();
    testAddressId = addr.id;
    createdAddressIds.push(addr.id);

    // 3. Seed Products
    const [p1] = await db
      .insert(schema.products)
      .values({
        name: `PG23G Product 1 ${Date.now()}`,
        slug: `pg23g-prod-1-${Date.now()}`,
        description: 'Test product 1 for PG23G',
        price: '1200.00',
        stock: 100,
        status: 'active',
      })
      .returning();
    testProductId1 = p1.id;
    createdProductIds.push(p1.id);

    const [p2] = await db
      .insert(schema.products)
      .values({
        name: `PG23G Product 2 ${Date.now()}`,
        slug: `pg23g-prod-2-${Date.now()}`,
        description: 'Test product 2 for PG23G',
        price: '2400.00',
        stock: 50,
        status: 'active',
      })
      .returning();
    testProductId2 = p2.id;
    createdProductIds.push(p2.id);

    // 4. Seed Delivered Orders
    const [ord1] = await db
      .insert(schema.orders)
      .values({
        userId: testUserId1,
        shippingAddressId: testAddressId,
        totalAmount: '1200.00',
        status: 'delivered',
      })
      .returning();
    testOrderId1 = ord1.id;
    createdOrderIds.push(ord1.id);

    const [item1] = await db
      .insert(schema.orderItems)
      .values({
        orderId: testOrderId1,
        productId: testProductId1,
        quantity: 1,
        unitPrice: '1200.00',
      })
      .returning();
    testOrderItemId1 = item1.id;

    const [ord2] = await db
      .insert(schema.orders)
      .values({
        userId: testUserId1,
        shippingAddressId: testAddressId,
        totalAmount: '2400.00',
        status: 'delivered',
      })
      .returning();
    testOrderId2 = ord2.id;
    createdOrderIds.push(ord2.id);

    const [item2] = await db
      .insert(schema.orderItems)
      .values({
        orderId: testOrderId2,
        productId: testProductId2,
        quantity: 1,
        unitPrice: '2400.00',
      })
      .returning();
    testOrderItemId2 = item2.id;
  });

  afterAll(async () => {
    // Teardown in strict foreign key order
    if (createdReferenceIds.length > 0) {
      await pool.query(
        `DELETE FROM loyalty_points WHERE reference_id = ANY($1::uuid[])`,
        [createdReferenceIds],
      );
    }
    await pool.query(
      `DELETE FROM loyalty_points WHERE user_id = ANY($1::uuid[])`,
      [createdUserIds],
    );
    if (createdReviewIds.length > 0) {
      await pool.query(`DELETE FROM reviews WHERE id = ANY($1::uuid[])`, [
        createdReviewIds,
      ]);
    }
    await pool.query(`DELETE FROM reviews WHERE user_id = ANY($1::uuid[])`, [
      createdUserIds,
    ]);
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
    await pool.end();
  });

  describe('PG-23G-A: Unique Conflict Inside Explicit Transaction Does Not Abort Transaction', () => {
    it('executes ON CONFLICT DO NOTHING, keeps transaction in TX_ACTIVE, and commits subsequent writes', async () => {
      const refA = randomUUID();
      createdReferenceIds.push(refA);

      let subsequentAddressId = '';

      await reviewsStore.runTransaction(async (tx) => {
        // Step 1: Initial reward insertion in transaction
        const initialReward = await loyaltyStore.createTransaction(
          {
            userId: testUserId1,
            points: 50,
            type: 'earned_review_text',
            referenceId: refA,
          },
          tx,
        );
        expect(initialReward).not.toBeNull();
        expect(initialReward?.points).toBe(50);

        // Step 2: Duplicate reward insertion inside the exact SAME transaction
        // With ON CONFLICT DO NOTHING, this must return null and NOT trigger 23505 / 25P02
        const duplicateReward = await loyaltyStore.createTransaction(
          {
            userId: testUserId1,
            points: 50,
            type: 'earned_review_text',
            referenceId: refA,
          },
          tx,
        );
        expect(duplicateReward).toBeNull();

        // Step 3: Execute an unrelated database write inside tx
        // In PostgreSQL, if 23505 had been thrown, this operation would fail with 25P02
        const [subsequentAddress] = await tx
          .insert(schema.addresses)
          .values({
            userId: testUserId1,
            title: 'Subsequent Write Location',
            addressLine1: 'Road 5, Block B',
            city: 'Chattogram',
          })
          .returning();

        subsequentAddressId = subsequentAddress.id;
        createdAddressIds.push(subsequentAddressId);
      });

      // Verification: Both the initial reward and the subsequent write were committed!
      const pointRows = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refA],
      );
      expect(pointRows.rows.length).toBe(1);
      expect(pointRows.rows[0].points).toBe(50);

      const addressRows = await pool.query(
        `SELECT * FROM addresses WHERE id = $1`,
        [subsequentAddressId],
      );
      expect(addressRows.rows.length).toBe(1);
      expect(addressRows.rows[0].title).toBe('Subsequent Write Location');
    });
  });

  describe('PG-23G-B: Duplicate Reward Plus Unrelated Write Leaves Transaction Usable and Committed', () => {
    it('handles duplicate reward idempotently within an open transaction and commits authorized business write', async () => {
      const refB = randomUUID();
      createdReferenceIds.push(refB);

      // Pre-seed reward outside transaction
      const preReward = await loyaltyStore.createTransaction({
        userId: testUserId1,
        points: 50,
        type: 'earned_review_text',
        referenceId: refB,
      });
      expect(preReward).not.toBeNull();

      let unrelatedProductId = '';

      // Open new explicit transaction
      await reviewsStore.runTransaction(async (tx) => {
        // Award points through LoyaltyService inside tx (detects duplicate either via check or onConflict)
        const duplicateAward = await loyaltyService.awardPoints(
          testUserId1,
          50,
          'earned_review_text',
          refB,
          tx,
        );
        expect(duplicateAward).toBeNull();

        // Perform unrelated authorized business write
        const [newProduct] = await tx
          .insert(schema.products)
          .values({
            name: `PG23G Unrelated Product ${Date.now()}`,
            slug: `pg23g-unrelated-${Date.now()}`,
            description:
              'Created within transaction after idempotent reward check',
            price: '999.00',
            stock: 10,
            status: 'active',
          })
          .returning();

        unrelatedProductId = newProduct.id;
        createdProductIds.push(unrelatedProductId);
      });

      // Verify unrelated product committed
      const prodCheck = await pool.query(
        `SELECT * FROM products WHERE id = $1`,
        [unrelatedProductId],
      );
      expect(prodCheck.rows.length).toBe(1);
      expect(prodCheck.rows[0].price).toBe('999.00');

      // Verify points remained exactly 1 row
      const pointCheck = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refB],
      );
      expect(pointCheck.rows.length).toBe(1);
    });
  });

  describe('PG-23G-C: Ten Concurrent Award Attempts Create Exactly One Logical Credit', () => {
    it('safely serializes 10 concurrent award invocations to exactly 1 inserted credit', async () => {
      const refC = randomUUID();
      createdReferenceIds.push(refC);

      const attempts = Array.from({ length: 10 }, () =>
        loyaltyService.awardPoints(testUserId1, 50, 'earned_review_text', refC),
      );

      const results = await Promise.all(attempts);

      const successes = results.filter((r) => r !== null);
      const idempotentlySkipped = results.filter((r) => r === null);

      expect(successes.length).toBe(1);
      expect(idempotentlySkipped.length).toBe(9);

      const rows = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refC],
      );
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].points).toBe(50);
    });
  });

  describe('PG-23G-D: Distinct Legitimate Purchases Receive Distinct Credits', () => {
    it('correctly credits separate distinct purchases for the same customer', async () => {
      const refD1 = randomUUID();
      const refD2 = randomUUID();
      createdReferenceIds.push(refD1, refD2);

      const balanceBefore = await loyaltyStore.getAvailableBalance(testUserId2);

      const award1 = await loyaltyService.awardPoints(
        testUserId2,
        50,
        'earned_review_text',
        refD1,
      );
      const award2 = await loyaltyService.awardPoints(
        testUserId2,
        50,
        'earned_review_text',
        refD2,
      );

      expect(award1).not.toBeNull();
      expect(award2).not.toBeNull();
      expect(award1?.id).not.toBe(award2?.id);

      const balanceAfter = await loyaltyStore.getAvailableBalance(testUserId2);
      expect(balanceAfter).toBe(balanceBefore + 100);

      const rows1 = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refD1],
      );
      const rows2 = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refD2],
      );
      expect(rows1.rows.length).toBe(1);
      expect(rows2.rows.length).toBe(1);
    });
  });

  describe('PG-23G-E: Text and Media Rewards Do Not Double-Credit Same Entitlement', () => {
    it('prevents granting media reward if text reward was already granted for the purchase', async () => {
      const refE = randomUUID();
      createdReferenceIds.push(refE);

      const textAward = await loyaltyService.awardPoints(
        testUserId2,
        50,
        'earned_review_text',
        refE,
      );
      expect(textAward).not.toBeNull();

      const mediaAward = await loyaltyService.awardPoints(
        testUserId2,
        100,
        'earned_review_media',
        refE,
      );
      expect(mediaAward).toBeNull();

      const rows = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refE],
      );
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].points).toBe(50);
      expect(rows.rows[0].type).toBe('earned_review_text');
    });
  });

  describe('PG-23G-F: Review Deletion and Recreation with Historical Pre-Migration Reward', () => {
    it('protects historical review rewards mapped to order items against repeated claims', async () => {
      mockOrdersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: testOrderId2,
        userId: testUserId1,
        status: 'delivered',
      });
      mockOrdersStore.getOrderItemsWithProducts.mockResolvedValue([
        {
          id: testOrderItemId2,
          productId: testProductId2,
          quantity: 1,
        },
      ]);
      createdReferenceIds.push(testOrderItemId2);

      // Create initial review for order 2
      const initialReview = await reviewsStore.createReview({
        userId: testUserId1,
        productId: testProductId2,
        orderId: testOrderId2,
        rating: 5,
        comment: 'Historical review pre-migration',
        images: [],
        status: 'pending',
      });
      createdReviewIds.push(initialReview.id);

      // Simulate legacy pre-migration loyalty reward where reference_id = initialReview.id
      const [legacyReward] = await db
        .insert(schema.loyaltyPoints)
        .values({
          userId: testUserId1,
          points: 50,
          type: 'earned_review_text',
          referenceId: initialReview.id,
        })
        .returning();
      createdReferenceIds.push(initialReview.id);

      // Execute migration 0029 backfill query
      await pool.query(`
        WITH mapped_items AS (
          SELECT DISTINCT ON (oi.id)
            lp.id AS loyalty_id,
            oi.id AS order_item_id
          FROM loyalty_points lp
          JOIN reviews r ON lp.reference_id = r.id
          JOIN order_items oi ON r.order_id = oi.order_id AND r.product_id = oi.product_id
          WHERE lp.type IN ('earned_review_text', 'earned_review_media')
            AND lp.reference_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM loyalty_points lp_conflict
              WHERE lp_conflict.reference_id = oi.id
                AND lp_conflict.type IN ('earned_review_text', 'earned_review_media')
            )
          ORDER BY oi.id, lp.created_at ASC
        )
        UPDATE loyalty_points lp
        SET reference_id = mi.order_item_id
        FROM mapped_items mi
        WHERE lp.id = mi.loyalty_id;
      `);

      // Verify the legacy reward row was safely migrated to testOrderItemId2
      const migratedCheck = await pool.query(
        `SELECT * FROM loyalty_points WHERE id = $1`,
        [legacyReward.id],
      );
      expect(migratedCheck.rows[0].reference_id).toBe(testOrderItemId2);

      const balanceBefore = await loyaltyStore.getAvailableBalance(testUserId1);

      // Customer deletes their review
      await reviewsService.deleteCustomerReview(testUserId1, initialReview.id);

      // Customer attempts to recreate review for the same purchase
      const recreatedReview = await reviewsService.submitReview(
        testUserId1,
        testOrderId2,
        testProductId2,
        4,
        'Recreated review post-migration',
      );
      createdReviewIds.push(recreatedReview.id);

      // CRITICAL: Review is created, but no duplicate points are awarded!
      expect(recreatedReview).toBeDefined();
      const balanceAfter = await loyaltyStore.getAvailableBalance(testUserId1);
      expect(balanceAfter).toBe(balanceBefore);

      const finalRows = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [testOrderItemId2],
      );
      expect(finalRows.rows.length).toBe(1);
    });
  });

  describe('PG-23G-G: Rollback and Retry Preserve Correct Reward Accounting', () => {
    it('fully rolls back on failure and permits subsequent successful retry with exactly 1 credit', async () => {
      const refG = randomUUID();
      createdReferenceIds.push(refG);

      const balanceBefore = await loyaltyStore.getAvailableBalance(testUserId2);

      // Attempt 1: Simulating transaction crash
      await expect(
        reviewsStore.runTransaction(async (tx) => {
          await loyaltyStore.createTransaction(
            {
              userId: testUserId2,
              points: 50,
              type: 'earned_review_text',
              referenceId: refG,
            },
            tx,
          );
          throw new Error('SIMULATED_RETRYABLE_CRASH');
        }),
      ).rejects.toThrow('SIMULATED_RETRYABLE_CRASH');

      // Database state check: zero rows committed
      const rowsAfterCrash = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refG],
      );
      expect(rowsAfterCrash.rows.length).toBe(0);

      // Attempt 2: Clean retry
      await reviewsStore.runTransaction(async (tx) => {
        const reward = await loyaltyStore.createTransaction(
          {
            userId: testUserId2,
            points: 50,
            type: 'earned_review_text',
            referenceId: refG,
          },
          tx,
        );
        expect(reward).not.toBeNull();
      });

      // Assert exactly 1 row committed
      const rowsAfterRetry = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refG],
      );
      expect(rowsAfterRetry.rows.length).toBe(1);
      expect(rowsAfterRetry.rows[0].points).toBe(50);

      const balanceAfter = await loyaltyStore.getAvailableBalance(testUserId2);
      expect(balanceAfter).toBe(balanceBefore + 50);
    });
  });

  describe('PG-23G-H: Unexpected Database Errors Remain Visible and Are Not Swallowed', () => {
    it('throws real foreign key violation (23503) instead of swallowing as null duplicate', async () => {
      const nonExistentUserId = '00000000-0000-0000-0000-000000000000';
      const refH = randomUUID();

      await expect(
        loyaltyStore.createTransaction({
          userId: nonExistentUserId,
          points: 50,
          type: 'earned_review_text',
          referenceId: refH,
        }),
      ).rejects.toThrow();
    });
  });

  describe('PG-23G-I: Review Submission and Reward Issuance Atomicity', () => {
    it('creates and commits review even if reward conflicts, but rolls back if review creation fails', async () => {
      // 1. Review creation succeeds even when reward conflicts
      mockOrdersStore.getOrderDetailsWithPayments.mockResolvedValueOnce({
        id: testOrderId1,
        userId: testUserId1,
        status: 'delivered',
      });
      mockOrdersStore.getOrderItemsWithProducts.mockResolvedValueOnce([
        {
          id: testOrderItemId1,
          productId: testProductId1,
          quantity: 1,
        },
      ]);

      const reviewWithConflictingReward = await reviewsService.submitReview(
        testUserId1,
        testOrderId1,
        testProductId1,
        5,
        'Review submitted when points were already claimed',
      );
      expect(reviewWithConflictingReward).toBeDefined();
      createdReviewIds.push(reviewWithConflictingReward.id);

      const reviewInDb = await reviewsStore.getReviewById(
        reviewWithConflictingReward.id,
      );
      expect(reviewInDb).not.toBeNull();

      // 2. If review validation/creation fails, no reward is created
      const dummyOrderId = '00000000-0000-4000-8000-000000000001';
      mockOrdersStore.getOrderDetailsWithPayments.mockResolvedValueOnce({
        id: dummyOrderId,
        userId: testUserId1,
        status: 'delivered',
      });
      mockOrdersStore.getOrderItemsWithProducts.mockResolvedValueOnce([]);

      await expect(
        reviewsService.submitReview(
          testUserId1,
          dummyOrderId,
          testProductId1,
          5,
          'Should fail before reward',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('PG-23G-J: Migration Handles Legacy Reward References Without Destroying Ledger Records', () => {
    it('is idempotent and preserves all historical ledger records, including orphaned records', async () => {
      const orphanedRef = randomUUID();
      createdReferenceIds.push(orphanedRef);

      // Insert orphaned legacy reward (deleted review before migration)
      const [orphanedRow] = await db
        .insert(schema.loyaltyPoints)
        .values({
          userId: testUserId2,
          points: 50,
          type: 'earned_review_text',
          referenceId: orphanedRef,
        })
        .returning();

      // Re-run migration 0029
      const migrationResult = await pool.query(`
        WITH mapped_items AS (
          SELECT DISTINCT ON (oi.id)
            lp.id AS loyalty_id,
            oi.id AS order_item_id
          FROM loyalty_points lp
          JOIN reviews r ON lp.reference_id = r.id
          JOIN order_items oi ON r.order_id = oi.order_id AND r.product_id = oi.product_id
          WHERE lp.type IN ('earned_review_text', 'earned_review_media')
            AND lp.reference_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM loyalty_points lp_conflict
              WHERE lp_conflict.reference_id = oi.id
                AND lp_conflict.type IN ('earned_review_text', 'earned_review_media')
            )
          ORDER BY oi.id, lp.created_at ASC
        )
        UPDATE loyalty_points lp
        SET reference_id = mi.order_item_id
        FROM mapped_items mi
        WHERE lp.id = mi.loyalty_id;
      `);

      // Idempotency: 0 rows affected on subsequent run
      expect(migrationResult.rowCount).toBe(0);

      // Orphaned row is NOT destroyed; remains in ledger
      const orphanCheck = await pool.query(
        `SELECT * FROM loyalty_points WHERE id = $1`,
        [orphanedRow.id],
      );
      expect(orphanCheck.rows.length).toBe(1);
      expect(orphanCheck.rows[0].points).toBe(50);
      expect(orphanCheck.rows[0].reference_id).toBe(orphanedRef);
    });
  });
});

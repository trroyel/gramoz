/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inArray, sql } from 'drizzle-orm';
import * as schema from '@database/schema';
import { LoyaltyStore } from './loyalty.store';
import { LoyaltyService } from './loyalty.service';
import { ReviewsStore } from '../reviews/reviews.store';
import { ReviewsService } from '../reviews/reviews.service';
import { BadRequestException } from '@nestjs/common';

describe('Loyalty Concurrency & Review Reward Idempotency (Real PostgreSQL 16 — TASK-23F)', () => {
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
  let testProductId: string;
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

    // 1. Seed Users
    const [u1] = await db
      .insert(schema.users)
      .values({
        email: `loy-test-user-1-${Date.now()}@gramoz.test`,
        fullName: 'Loyalty User 1',
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
        email: `loy-test-user-2-${Date.now()}@gramoz.test`,
        fullName: 'Loyalty User 2',
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
        title: 'Home',
        addressLine1: 'Road 11, House 22',
        city: 'Dhaka',
      })
      .returning();
    testAddressId = addr.id;
    createdAddressIds.push(addr.id);

    // 3. Seed Product
    const [prod] = await db
      .insert(schema.products)
      .values({
        name: `Loyalty Test Product ${Date.now()}`,
        slug: `loy-prod-${Date.now()}`,
        description: 'Test product for loyalty rewards',
        price: '1500.00',
        stock: 50,
        status: 'active',
      })
      .returning();
    testProductId = prod.id;
    createdProductIds.push(prod.id);

    // 4. Seed Delivered Order 1 with OrderItem 1
    const [ord1] = await db
      .insert(schema.orders)
      .values({
        userId: testUserId1,
        shippingAddressId: testAddressId,
        totalAmount: '1500.00',
        status: 'delivered',
      })
      .returning();
    testOrderId1 = ord1.id;
    createdOrderIds.push(ord1.id);

    const [item1] = await db
      .insert(schema.orderItems)
      .values({
        orderId: testOrderId1,
        productId: testProductId,
        quantity: 1,
        unitPrice: '1500.00',
      })
      .returning();
    testOrderItemId1 = item1.id;

    // 5. Seed Delivered Order 2 with OrderItem 2
    const [ord2] = await db
      .insert(schema.orders)
      .values({
        userId: testUserId1,
        shippingAddressId: testAddressId,
        totalAmount: '1500.00',
        status: 'delivered',
      })
      .returning();
    testOrderId2 = ord2.id;
    createdOrderIds.push(ord2.id);

    const [item2] = await db
      .insert(schema.orderItems)
      .values({
        orderId: testOrderId2,
        productId: testProductId,
        quantity: 1,
        unitPrice: '1500.00',
      })
      .returning();
    testOrderItemId2 = item2.id;
  });

  afterAll(async () => {
    // Teardown created records in clean FK order
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

  describe('LOY-23F-A: Same Review Reward Event Sent 10 Times Concurrently', () => {
    it('awards points exactly once across 10 concurrent reward invocations', async () => {
      const refId = '11111111-1111-4111-8111-111111111111';
      createdReferenceIds.push(refId);

      // 10 concurrent requests to award review points for the exact same referenceId
      const promises = Array.from({ length: 10 }, () =>
        loyaltyService.awardPoints(
          testUserId1,
          50,
          'earned_review_text',
          refId,
        ),
      );

      const results = await Promise.all(promises);

      // Exactly 1 request succeeds in inserting; 9 return null
      const successfulAwards = results.filter((r) => r !== null);
      const skippedAwards = results.filter((r) => r === null);

      expect(successfulAwards.length).toBe(1);
      expect(skippedAwards.length).toBe(9);

      // Database verification: exactly 1 row committed in PostgreSQL
      const rows = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refId],
      );
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].points).toBe(50);
      expect(rows.rows[0].type).toBe('earned_review_text');
    });
  });

  describe('LOY-23F-B: Review Deleted and Recreated for Same Purchase', () => {
    it('prevents duplicate loyalty rewards when a review is deleted and re-submitted', async () => {
      mockOrdersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: testOrderId1,
        userId: testUserId1,
        status: 'delivered',
      });
      mockOrdersStore.getOrderItemsWithProducts.mockResolvedValue([
        {
          id: testOrderItemId1,
          productId: testProductId,
          quantity: 1,
        },
      ]);
      createdReferenceIds.push(testOrderItemId1);

      // 1. Initial review submission -> earns 50 points
      const review1 = await reviewsService.submitReview(
        testUserId1,
        testOrderId1,
        testProductId,
        5,
        'First review for this product purchase',
      );
      createdReviewIds.push(review1.id);

      // Verify points were awarded
      let balance = await loyaltyStore.getAvailableBalance(testUserId1);
      expect(balance).toBe(100); // 50 from LOY-23F-A + 50 from review1

      // 2. Customer deletes their review
      await reviewsService.deleteCustomerReview(testUserId1, review1.id);

      // Verify review record is deleted from PostgreSQL
      const reviewInDb = await reviewsStore.getReviewById(review1.id);
      expect(reviewInDb).toBeNull();

      // Verify loyalty ledger row remains intact (immutable financial audit history)
      const ledgerRows = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [testOrderItemId1],
      );
      expect(ledgerRows.rows.length).toBe(1);

      // 3. Customer submits a new review for the exact same order and product
      const review2 = await reviewsService.submitReview(
        testUserId1,
        testOrderId1,
        testProductId,
        4,
        'Second review after deleting the original one',
      );
      createdReviewIds.push(review2.id);

      // Verify new review was created in PostgreSQL
      expect(review2).toBeDefined();
      expect(review2.id).not.toBe(review1.id);

      // CRITICAL ASSERTION: No additional points awarded for the recreated review
      balance = await loyaltyStore.getAvailableBalance(testUserId1);
      expect(balance).toBe(100); // Balance unchanged!

      const finalLedgerRows = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [testOrderItemId1],
      );
      expect(finalLedgerRows.rows.length).toBe(1); // Still exactly 1 row!
    });
  });

  describe('LOY-23F-C: Review Edited Multiple Times', () => {
    it('awards 0 additional points when a review is edited multiple times', async () => {
      const balanceBefore = await loyaltyStore.getAvailableBalance(testUserId1);
      const ledgerCountBefore = await pool.query(
        `SELECT count(*)::int as count FROM loyalty_points WHERE user_id = $1`,
        [testUserId1],
      );

      // Fetch active review
      const myReviews = await reviewsService.getMyReviews(testUserId1);
      const activeReview = myReviews[0];
      expect(activeReview).toBeDefined();

      // Edit 1: change rating and comment
      await reviewsService.updateCustomerReview(testUserId1, activeReview.id, {
        rating: 5,
        comment: 'Edited comment with great praise',
      });

      // Edit 2: add images
      await reviewsService.updateCustomerReview(testUserId1, activeReview.id, {
        images: ['https://media.gramoz.com/products/img1.jpg'],
      });

      // Edit 3: edit comment again
      await reviewsService.updateCustomerReview(testUserId1, activeReview.id, {
        comment: 'Third revision of my comment',
      });

      // Assert balance and ledger count are strictly identical
      const balanceAfter = await loyaltyStore.getAvailableBalance(testUserId1);
      expect(balanceAfter).toBe(balanceBefore);

      const ledgerCountAfter = await pool.query(
        `SELECT count(*)::int as count FROM loyalty_points WHERE user_id = $1`,
        [testUserId1],
      );
      expect(ledgerCountAfter.rows[0].count).toBe(
        ledgerCountBefore.rows[0].count,
      );
    });
  });

  describe('LOY-23F-D: Different Legitimate Purchases Earn Separate Eligible Rewards', () => {
    it('allows a customer to earn points for separate orders/purchases of the product', async () => {
      mockOrdersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: testOrderId2,
        userId: testUserId1,
        status: 'delivered',
      });
      mockOrdersStore.getOrderItemsWithProducts.mockResolvedValue([
        {
          id: testOrderItemId2,
          productId: testProductId,
          quantity: 1,
        },
      ]);
      createdReferenceIds.push(testOrderItemId2);

      const balanceBefore = await loyaltyStore.getAvailableBalance(testUserId1);

      // Submit review for Order 2
      const reviewOrder2 = await reviewsService.submitReview(
        testUserId1,
        testOrderId2,
        testProductId,
        5,
        'Legitimate second purchase review for separate order',
      );
      createdReviewIds.push(reviewOrder2.id);

      // Assert separate points (50 points) were correctly awarded
      const balanceAfter = await loyaltyStore.getAvailableBalance(testUserId1);
      expect(balanceAfter).toBe(balanceBefore + 50);

      // Verify separate ledger record exists for OrderItem 2
      const item2Rows = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [testOrderItemId2],
      );
      expect(item2Rows.rows.length).toBe(1);
      expect(item2Rows.rows[0].points).toBe(50);
    });
  });

  describe('LOY-23F-E: Concurrent Award Transactions Across Independent PostgreSQL Connections', () => {
    it('enforces database-level serialization on 5 independent pool connections', async () => {
      const refId = '22222222-2222-4222-8222-222222222222';
      createdReferenceIds.push(refId);

      // Open 5 separate pool clients
      const clients = await Promise.all(
        Array.from({ length: 5 }, () => pool.connect()),
      );

      try {
        const attemptAwardOnClient = async (client: any) => {
          try {
            await client.query('BEGIN');
            const insertRes = await client.query(
              `INSERT INTO loyalty_points (user_id, points, type, reference_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (reference_id) WHERE type IN ('earned_review_text', 'earned_review_media') AND reference_id IS NOT NULL
               DO NOTHING
               RETURNING *`,
              [testUserId2, 50, 'earned_review_text', refId],
            );
            await client.query('COMMIT');
            return insertRes.rows.length; // 1 if inserted, 0 if conflict DO NOTHING
          } catch (err) {
            await client.query('ROLLBACK');
            return 0;
          }
        };

        const results = await Promise.all(
          clients.map((c) => attemptAwardOnClient(c)),
        );

        // Exactly 1 client inserted; 4 hit conflict DO NOTHING
        const insertedCount = results.reduce((acc, val) => acc + val, 0);
        expect(insertedCount).toBe(1);

        // Verify database contains exactly 1 row
        const rowCheck = await pool.query(
          `SELECT * FROM loyalty_points WHERE reference_id = $1`,
          [refId],
        );
        expect(rowCheck.rows.length).toBe(1);
      } finally {
        clients.forEach((c) => c.release());
      }
    });
  });

  describe('LOY-23F-F: Crash or Rollback During Award Creation', () => {
    it('rolls back both review and loyalty points if transaction aborts mid-flight', async () => {
      const refId = '33333333-3333-4333-8333-333333333333';
      createdReferenceIds.push(refId);

      const balanceBefore = await loyaltyStore.getAvailableBalance(testUserId2);

      // Run aborted transaction simulating crash/failure after review creation
      await expect(
        reviewsStore.runTransaction(async (tx) => {
          await reviewsStore.createReview(
            {
              userId: testUserId2,
              productId: testProductId,
              orderId: testOrderId1,
              rating: 5,
              comment: 'About to crash',
              images: [],
              status: 'pending',
            },
            tx,
          );

          await loyaltyService.awardPoints(
            testUserId2,
            50,
            'earned_review_text',
            refId,
            tx,
          );

          throw new Error('SIMULATED_TRANSACTION_CRASH');
        }),
      ).rejects.toThrow('SIMULATED_TRANSACTION_CRASH');

      // Assert rollback: zero loyalty points committed, balance intact
      const balanceAfter = await loyaltyStore.getAvailableBalance(testUserId2);
      expect(balanceAfter).toBe(balanceBefore);

      const ledgerCheck = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [refId],
      );
      expect(ledgerCheck.rows.length).toBe(0);
    });
  });

  describe('LOY-23F-G: Media Reward and Text Review Reward Policy Interaction', () => {
    it('blocks awarding media reward if text review reward was already granted for the purchase', async () => {
      const purchaseRefId = '44444444-4444-4444-8444-444444444444';
      createdReferenceIds.push(purchaseRefId);

      // 1. Initial text review reward granted
      const firstTextAward = await loyaltyService.awardPoints(
        testUserId2,
        50,
        'earned_review_text',
        purchaseRefId,
      );
      expect(firstTextAward).not.toBeNull();

      // 2. Attempt to grant media review points for the SAME purchase
      const secondMediaAward = await loyaltyService.awardPoints(
        testUserId2,
        100,
        'earned_review_media',
        purchaseRefId,
      );
      // Policy check: already awarded points for this purchase -> returns null
      expect(secondMediaAward).toBeNull();

      // Verify ledger has only the original 50 point text award
      const rows = await pool.query(
        `SELECT * FROM loyalty_points WHERE reference_id = $1`,
        [purchaseRefId],
      );
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].points).toBe(50);
      expect(rows.rows[0].type).toBe('earned_review_text');
    });
  });

  describe('LOY-23F-H: Refund/Cancellation and Reward Eligibility', () => {
    it('rejects review submission and loyalty reward if the order is cancelled or refunded', async () => {
      // Mock cancelled order
      mockOrdersStore.getOrderDetailsWithPayments.mockResolvedValueOnce({
        id: 'cancelled-order-uuid',
        userId: testUserId1,
        status: 'cancelled',
      });

      await expect(
        reviewsService.submitReview(
          testUserId1,
          'cancelled-order-uuid',
          testProductId,
          5,
          'Review on cancelled order',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'You can only review products from delivered orders',
        ),
      );

      // Mock refunded order
      mockOrdersStore.getOrderDetailsWithPayments.mockResolvedValueOnce({
        id: 'refunded-order-uuid',
        userId: testUserId1,
        status: 'refunded',
      });

      await expect(
        reviewsService.submitReview(
          testUserId1,
          'refunded-order-uuid',
          testProductId,
          5,
          'Review on refunded order',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'You can only review products from delivered orders',
        ),
      );
    });
  });
});

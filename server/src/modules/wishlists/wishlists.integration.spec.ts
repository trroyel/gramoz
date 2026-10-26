/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@database/schema';
import { WishlistsStore } from './wishlists.store';
import { WishlistsService } from './wishlists.service';

describe('Wishlists PostgreSQL Concurrency, Cascades & Isolation (Real PostgreSQL 16 — TASK-23)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let wishlistsStore: WishlistsStore;
  let wishlistsService: WishlistsService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  let testUserId1: string;
  let testUserId2: string;
  let testProductId1: string;
  let testProductId2: string;

  const createdUserIds: string[] = [];
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 10,
    });
    db = drizzle(pool, { schema });
    wishlistsStore = new WishlistsStore(db as any);
    wishlistsService = new WishlistsService(wishlistsStore);

    // Seed 2 distinct test users
    const [u1] = await db
      .insert(schema.users)
      .values({
        email: `wish-user1-${Date.now()}@test.gramoz.com`,
        passwordHash: 'dummy',
        fullName: 'Wishlist Tester 1',
        status: 'active',
      })
      .returning();
    testUserId1 = u1.id;
    createdUserIds.push(u1.id);

    const [u2] = await db
      .insert(schema.users)
      .values({
        email: `wish-user2-${Date.now()}@test.gramoz.com`,
        passwordHash: 'dummy',
        fullName: 'Wishlist Tester 2',
        status: 'active',
      })
      .returning();
    testUserId2 = u2.id;
    createdUserIds.push(u2.id);

    // Seed 2 active products
    const [p1] = await db
      .insert(schema.products)
      .values({
        name: `Wishlist Product 1 ${Date.now()}`,
        slug: `wish-prod-1-${Date.now()}`,
        description: 'Test product for wishlist concurrency',
        price: '250.00',
        stock: 100,
        status: 'active',
      })
      .returning();
    testProductId1 = p1.id;
    createdProductIds.push(p1.id);

    const [p2] = await db
      .insert(schema.products)
      .values({
        name: `Wishlist Product 2 ${Date.now()}`,
        slug: `wish-prod-2-${Date.now()}`,
        description: 'Test product for cross customer isolation',
        price: '300.00',
        stock: 50,
        status: 'active',
      })
      .returning();
    testProductId2 = p2.id;
    createdProductIds.push(p2.id);
  });

  afterAll(async () => {
    // Cleanup wishlist rows, products, and users
    try {
      if (createdProductIds.length > 0) {
        await pool.query(
          `DELETE FROM wishlists WHERE product_id = ANY($1::uuid[])`,
          [createdProductIds],
        );
        await pool.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [
          createdProductIds,
        ]);
      }
      if (createdUserIds.length > 0) {
        await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
          createdUserIds,
        ]);
      }
    } finally {
      await pool.end();
    }
  });

  describe('CONC-23-H: Concurrent Wishlist Addition', () => {
    it('collapses 10 simultaneous add requests into exactly 1 logical wishlist entry', async () => {
      // 10 concurrent requests to add product 1 to user 1's wishlist
      const promises = Array.from({ length: 10 }, () =>
        wishlistsService.add(testUserId1, testProductId1),
      );

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(10); // All succeed idempotently

      // Verify database has exactly 1 record for this (user_id, product_id) pair
      const checkRes = await pool.query(
        `SELECT count(*)::int as count FROM wishlists WHERE user_id = $1 AND product_id = $2`,
        [testUserId1, testProductId1],
      );
      expect(checkRes.rows[0].count).toBe(1);
    });
  });

  describe('CONC-23-I: Add Versus Remove Race', () => {
    it('maintains consistent state when add and remove race on same product', async () => {
      const raceAttempts = [
        wishlistsService.add(testUserId1, testProductId2),
        wishlistsService.remove(testUserId1, testProductId2),
        wishlistsService.add(testUserId1, testProductId2),
      ];

      const settled = await Promise.allSettled(raceAttempts);
      for (const res of settled) {
        expect(res.status).toBe('fulfilled');
      }

      // Check whether final state is either 0 or 1, and checkStatus matches real count
      const checkRes = await pool.query(
        `SELECT count(*)::int as count FROM wishlists WHERE user_id = $1 AND product_id = $2`,
        [testUserId1, testProductId2],
      );
      const dbCount = checkRes.rows[0].count;
      expect([0, 1]).toContain(dbCount);

      const status = await wishlistsService.check(testUserId1, testProductId2);
      expect(status.isFavorited).toBe(dbCount === 1);
    });
  });

  describe('CONC-23-J: Cross-Customer Isolation', () => {
    it('prevents cross-customer data modification and view leaks', async () => {
      // Clean up previous test entries for pure isolation test
      await pool.query(
        'DELETE FROM wishlists WHERE user_id = ANY($1::uuid[])',
        [[testUserId1, testUserId2]],
      );

      // Ensure user 1 has product 1 wishlisted
      await wishlistsService.add(testUserId1, testProductId1);

      // User 2 adds product 2
      await wishlistsService.add(testUserId2, testProductId2);

      // User 1 fetches wishlist -> should only see product 1
      const user1List = await wishlistsService.findByUser(testUserId1);
      expect(user1List.some((w) => w.productId === testProductId1)).toBe(true);
      expect(user1List.some((w) => w.productId === testProductId2)).toBe(false);

      // User 2 fetches wishlist -> should only see product 2
      const user2List = await wishlistsService.findByUser(testUserId2);
      expect(user2List.some((w) => w.productId === testProductId2)).toBe(true);
      expect(user2List.some((w) => w.productId === testProductId1)).toBe(false);

      // User 1 attempts to remove product 2 (which User 2 favorited)
      await wishlistsService.remove(testUserId1, testProductId2);

      // User 2's wishlist for product 2 MUST remain completely intact
      const user2Check = await wishlistsService.check(
        testUserId2,
        testProductId2,
      );
      expect(user2Check.isFavorited).toBe(true);
    });
  });

  describe('CONC-23-K: Product Deletion Cascade & Indexing', () => {
    it('safely cascades wishlist deletion without orphan records when a product is deleted', async () => {
      // Create a disposable product to be deleted
      const [disposableProd] = await db
        .insert(schema.products)
        .values({
          name: `Disposable Product ${Date.now()}`,
          slug: `disp-prod-${Date.now()}`,
          description: 'To test ON DELETE CASCADE',
          price: '99.00',
          stock: 10,
          status: 'active',
        })
        .returning();

      // Add to both users' wishlists
      await wishlistsService.add(testUserId1, disposableProd.id);
      await wishlistsService.add(testUserId2, disposableProd.id);

      // Verify both exist
      const beforeRes = await pool.query(
        `SELECT count(*)::int as count FROM wishlists WHERE product_id = $1`,
        [disposableProd.id],
      );
      expect(beforeRes.rows[0].count).toBe(2);

      // Hard delete the product
      await pool.query(`DELETE FROM products WHERE id = $1`, [
        disposableProd.id,
      ]);

      // Both wishlist references must be automatically removed by cascade
      const afterRes = await pool.query(
        `SELECT count(*)::int as count FROM wishlists WHERE product_id = $1`,
        [disposableProd.id],
      );
      expect(afterRes.rows[0].count).toBe(0);
    });
  });

  describe('CONC-23-L: Concurrent Wishlist and Cart Interaction', () => {
    it('allows concurrent add to cart and remove from wishlist without conflict', async () => {
      // Ensure product 1 is in user 1's wishlist
      await wishlistsService.add(testUserId1, testProductId1);

      // Concurrently insert to cart_items and remove from wishlists
      const operations = [
        pool.query(
          `INSERT INTO cart_items (id, user_id, product_id, quantity)
           VALUES (gen_random_uuid(), $1, $2, 1)
           ON CONFLICT DO NOTHING;`,
          [testUserId1, testProductId1],
        ),
        wishlistsService.remove(testUserId1, testProductId1),
      ];

      const settled = await Promise.allSettled(operations);
      expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);

      // Clean up cart item
      await pool.query(
        `DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2`,
        [testUserId1, testProductId1],
      );
    });
  });

  describe('EXPLAIN Plan Verification for Supporting Wishlist Indexes', () => {
    it('uses idx_wishlists_product_id for product lookups and cascade references', async () => {
      await pool.query('SET enable_seqscan = off;');
      try {
        const explainRes = await pool.query(
          `EXPLAIN (ANALYZE, BUFFERS)
           SELECT id FROM wishlists WHERE product_id = $1`,
          [testProductId1],
        );
        const planText = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');
        expect(planText).toContain('idx_wishlists_product_id');
        expect(planText).not.toContain('Seq Scan on wishlists');
      } finally {
        await pool.query('SET enable_seqscan = on;');
      }
    });

    it('uses idx_wishlists_user_created for user wishlist listing', async () => {
      await pool.query('SET enable_seqscan = off;');
      try {
        const explainRes = await pool.query(
          `EXPLAIN (ANALYZE, BUFFERS)
           SELECT id, product_id, created_at FROM wishlists WHERE user_id = $1 ORDER BY created_at DESC`,
          [testUserId1],
        );
        const planText = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');
        expect(planText).toContain('idx_wishlists_user_created');
        expect(planText).not.toContain('Seq Scan on wishlists');
      } finally {
        await pool.query('SET enable_seqscan = on;');
      }
    });
  });
});

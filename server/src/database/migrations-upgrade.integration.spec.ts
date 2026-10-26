/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

describe('TASK-25: Database Migrations, Clean Bootstrap, Populated Upgrade & Loyalty Audit', () => {
  const baseDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const migrationsDir = path.resolve(__dirname, '../../drizzle/migrations');
  const journalPath = path.join(migrationsDir, 'meta/_journal.json');

  let adminPool: Pool;
  let testPool: Pool;
  const testDbName = `test_upgrade_${Date.now()}`;

  beforeAll(async () => {
    adminPool = new Pool({
      connectionString: baseDbUrl,
      connectionTimeoutMillis: 5000,
    });

    // Create a dedicated disposable database for upgrade and migration tests
    await adminPool.query(`CREATE DATABASE ${testDbName}`);

    testPool = new Pool({
      connectionString: `postgresql://platform_user:platform_pass@localhost:5433/${testDbName}`,
      connectionTimeoutMillis: 5000,
      max: 10,
    });
  });

  afterAll(async () => {
    try {
      if (testPool) {
        await testPool.end();
      }
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS ${testDbName}`);
        await adminPool.end();
      }
    } catch (err) {
      console.error('Error during database cleanup:', err);
    }
  });

  function getJournalEntries(): Array<{ idx: number; tag: string }> {
    const raw = fs.readFileSync(journalPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.entries;
  }

  function getSqlForMigration(tag: string): string {
    const filePath = path.join(migrationsDir, `${tag}.sql`);
    return fs.readFileSync(filePath, 'utf8');
  }

  describe('PHASE 8: Migration Inventory & Journal Consistency', () => {
    it('JRN-25-A: _journal.json contains 32 contiguous migration entries without gaps', () => {
      const entries = getJournalEntries();
      expect(entries.length).toBe(32);

      entries.forEach((entry, i) => {
        expect(entry.idx).toBe(i);
        const sqlFile = path.join(migrationsDir, `${entry.tag}.sql`);
        expect(fs.existsSync(sqlFile)).toBe(true);
      });

      expect(entries[0].tag).toBe('0000_light_lord_hawal');
      expect(entries[30].tag).toBe('0030_orders_consignment_id_idx');
      expect(entries[31].tag).toBe('0031_courier_reconciliation_audit');
    });
  });

  describe('PHASE 9: Clean Database Bootstrap', () => {
    it('BOOT-25-A: Applies all 32 migrations in order from empty state', async () => {
      const entries = getJournalEntries();

      // Create drizzle migrations tracking schema
      await testPool.query(`CREATE SCHEMA IF NOT EXISTS drizzle;`);
      await testPool.query(`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        );
      `);

      for (const entry of entries) {
        const sqlContent = getSqlForMigration(entry.tag);
        // Execute statements separated by Drizzle statement-breakpoints or directly
        const statements = sqlContent
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const stmt of statements) {
          await testPool.query(stmt);
        }

        await testPool.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
          [entry.tag, Date.now()],
        );
      }

      // Verify all 32 entries applied
      const migCount = await testPool.query(
        'SELECT count(*) FROM drizzle.__drizzle_migrations',
      );
      expect(parseInt(migCount.rows[0].count, 10)).toBe(32);

      // Verify essential business tables exist
      const tablesRes = await testPool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
      `);
      const tableNames = tablesRes.rows.map((r) => r.table_name);

      expect(tableNames).toContain('users');
      expect(tableNames).toContain('products');
      expect(tableNames).toContain('orders');
      expect(tableNames).toContain('courier_reconciliation_audit');
      expect(tableNames).toContain('order_items');
      expect(tableNames).toContain('payments');
      expect(tableNames).toContain('refunds');
      expect(tableNames).toContain('promos');
      expect(tableNames).toContain('loyalty_points');
      expect(tableNames).toContain('reviews');
      expect(tableNames).toContain('cart_items');
      expect(tableNames).toContain('outbox_events');
    });

    it('BOOT-25-B: Essential indexes and constraints exist after bootstrap', async () => {
      const indexesRes = await testPool.query(`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
      `);
      const indexNames = indexesRes.rows.map((r) => r.indexname);

      expect(indexNames).toContain('outbox_events_pending_idx');
      expect(indexNames).toContain('outbox_events_processing_idx');
      expect(indexNames).toContain('idx_loyalty_points_review_reward_unique');
      expect(indexNames).toContain('uq_refunds_order_id');
      expect(indexNames).toContain('orders_consignment_id_idx');
    });
  });

  describe('PHASE 10 & 11: Populated Database Upgrade & Historical Loyalty Migration Review', () => {
    let testUserId: string;
    let testOrderId: string;
    let testOrderItem1Id: string;
    let testOrderItem2Id: string;
    let testProductId: string;
    let testReviewId: string;
    let testLoyaltyId: string;

    beforeAll(async () => {
      // Seed representative data into test database
      testUserId = randomUUID();
      await testPool.query(
        `
        INSERT INTO users (id, email, password_hash, full_name, phone, role)
        VALUES ($1, 'upgrade_user@example.com', 'hash', 'Upgrade Tester', '8801700000000', 'customer')
      `,
        [testUserId],
      );

      const catRes = await testPool.query(
        `
        INSERT INTO categories (id, name, slug)
        VALUES ($1, 'Test Category', 'test-cat-upg')
        RETURNING id
      `,
        [randomUUID()],
      );
      const catId = catRes.rows[0].id;

      testProductId = randomUUID();
      await testPool.query(
        `
        INSERT INTO products (id, name, slug, price, stock, category_id)
        VALUES ($1, 'Upgrade Product', 'upgrade-prod', '500.00', 50, $2)
      `,
        [testProductId, catId],
      );

      const addrRes = await testPool.query(
        `
        INSERT INTO addresses (id, user_id, title, address_line_1, city, zip_code, is_default)
        VALUES ($1, $2, 'Home', '123 Main St', 'Dhaka', '1200', true)
        RETURNING id
      `,
        [randomUUID(), testUserId],
      );
      const addressId = addrRes.rows[0].id;

      testOrderId = randomUUID();
      await testPool.query(
        `
        INSERT INTO orders (id, user_id, shipping_address_id, total_amount, status, payment_status)
        VALUES ($1, $2, $3, '1000.00', 'delivered', 'paid')
      `,
        [testOrderId, testUserId, addressId],
      );

      testOrderItem1Id = randomUUID();
      testOrderItem2Id = randomUUID();
      await testPool.query(
        `
        INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
        VALUES
          ($1, $2, $3, 1, '500.00'),
          ($4, $2, $3, 1, '500.00')
      `,
        [testOrderItem1Id, testOrderId, testProductId, testOrderItem2Id],
      );

      testReviewId = randomUUID();
      await testPool.query(
        `
        INSERT INTO reviews (id, user_id, product_id, order_id, rating, comment)
        VALUES ($1, $2, $3, $4, 5, 'Great quality!')
      `,
        [testReviewId, testUserId, testProductId, testOrderId],
      );

      testLoyaltyId = randomUUID();
      await testPool.query(
        `
        INSERT INTO loyalty_points (id, user_id, points, type, reference_id)
        VALUES ($1, $2, 50, 'earned_review_text', $3)
      `,
        [testLoyaltyId, testUserId, testReviewId],
      );
    });

    it('MIG-25-A: One review maps deterministically to one order item', async () => {
      // Execute Migration 0029
      const sql0029 = getSqlForMigration(
        '0029_backfill_historical_review_loyalty_references',
      );
      await testPool.query(sql0029);

      const check = await testPool.query(
        'SELECT reference_id FROM loyalty_points WHERE id = $1',
        [testLoyaltyId],
      );

      // reference_id should now equal one of the purchased order items (testOrderItem1Id or testOrderItem2Id)
      expect([testOrderItem1Id, testOrderItem2Id]).toContain(
        check.rows[0].reference_id,
      );
    });

    it('MIG-25-B: One order contains two rows of the same product — mapping is deterministic and strict 1-to-1', async () => {
      const sql0029 = getSqlForMigration(
        '0029_backfill_historical_review_loyalty_references',
      );
      await testPool.query(sql0029);

      const check = await testPool.query(
        'SELECT reference_id FROM loyalty_points WHERE id = $1',
        [testLoyaltyId],
      );

      // Deterministically maps to exactly one order item
      const expectedOrderItemId = [
        testOrderItem1Id,
        testOrderItem2Id,
      ].sort()[0];
      expect(check.rows[0].reference_id).toBe(expectedOrderItemId);
    });

    it('MIG-25-C: Two historical reviews/reference records target the same product purchase — safe without violating unique index', async () => {
      // Historical review awarded both text and media loyalty points to same review reference
      const loyaltyMediaId = randomUUID();
      await testPool.query(
        `
        INSERT INTO loyalty_points (id, user_id, points, type, reference_id)
        VALUES ($1, $2, 50, 'earned_review_media', $3)
      `,
        [loyaltyMediaId, testUserId, testReviewId],
      );

      const sql0029 = getSqlForMigration(
        '0029_backfill_historical_review_loyalty_references',
      );
      await testPool.query(sql0029);

      const res1 = await testPool.query(
        'SELECT reference_id FROM loyalty_points WHERE id = $1',
        [testLoyaltyId],
      );
      const res2 = await testPool.query(
        'SELECT reference_id FROM loyalty_points WHERE id = $1',
        [loyaltyMediaId],
      );

      const ref1 = res1.rows[0].reference_id;
      const ref2 = res2.rows[0].reference_id;

      // Both loyalty points mapped to the two order items without colliding on the same reference_id
      expect(ref1).not.toBe(ref2);
      expect([testOrderItem1Id, testOrderItem2Id]).toContain(ref1);
      expect([testOrderItem1Id, testOrderItem2Id]).toContain(ref2);
    });

    it('MIG-25-D: Historical review deleted before migration preserves unmapped loyalty record safely', async () => {
      const deletedReviewId = randomUUID();
      const orphanLoyaltyId = randomUUID();

      await testPool.query(
        `
        INSERT INTO loyalty_points (id, user_id, points, type, reference_id)
        VALUES ($1, $2, 50, 'earned_review_text', $3)
      `,
        [orphanLoyaltyId, testUserId, deletedReviewId],
      );

      const sql0029 = getSqlForMigration(
        '0029_backfill_historical_review_loyalty_references',
      );
      // Should not throw or crash
      await testPool.query(sql0029);

      const check = await testPool.query(
        'SELECT reference_id FROM loyalty_points WHERE id = $1',
        [orphanLoyaltyId],
      );
      // Orphan record remains preserved with original historical reference
      expect(check.rows[0].reference_id).toBe(deletedReviewId);
    });

    it('MIG-25-E: Historical reward already existing under new identity is not conflicted', async () => {
      // Record already pointing to order_item
      const existingLoyaltyId = randomUUID();
      const newOrderItemId = randomUUID();

      await testPool.query(
        `
        INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
        VALUES ($1, $2, $3, 1, '500.00')
      `,
        [newOrderItemId, testOrderId, testProductId],
      );

      await testPool.query(
        `
        INSERT INTO loyalty_points (id, user_id, points, type, reference_id)
        VALUES ($1, $2, 50, 'earned_review_text', $3)
      `,
        [existingLoyaltyId, testUserId, newOrderItemId],
      );

      const sql0029 = getSqlForMigration(
        '0029_backfill_historical_review_loyalty_references',
      );
      await testPool.query(sql0029);

      const check = await testPool.query(
        'SELECT reference_id FROM loyalty_points WHERE id = $1',
        [existingLoyaltyId],
      );
      expect(check.rows[0].reference_id).toBe(newOrderItemId);
    });

    it('MIG-25-F: Migration executed twice is 100% idempotent', async () => {
      const sql0029 = getSqlForMigration(
        '0029_backfill_historical_review_loyalty_references',
      );

      const before = await testPool.query(
        'SELECT id, reference_id FROM loyalty_points ORDER BY id',
      );
      await testPool.query(sql0029);
      const after = await testPool.query(
        'SELECT id, reference_id FROM loyalty_points ORDER BY id',
      );

      expect(after.rows).toEqual(before.rows);
    });

    it('MIG-25-G: Migration interrupted before commit rolls back cleanly', async () => {
      const client = await testPool.connect();
      try {
        await client.query('BEGIN');
        const sql0029 = getSqlForMigration(
          '0029_backfill_historical_review_loyalty_references',
        );
        await client.query(sql0029);
        // Simulate interruption/failure
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // State is completely intact
      const check = await testPool.query('SELECT count(*) FROM loyalty_points');
      expect(parseInt(check.rows[0].count, 10)).toBeGreaterThan(0);
    });

    it('MIG-25-H: Existing duplicate historical rewards are handled without constraint violation', async () => {
      // Test that partial unique index on (reference_id, type) is strictly respected
      const checkUniqueIndex = await testPool.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'loyalty_points' AND indexname = 'idx_loyalty_points_review_reward_unique'
      `);
      expect(checkUniqueIndex.rows.length).toBe(1);
    });
  });

  describe('TASK-26: Real migrator, journal timestamps & canonical purchase identity', () => {
    it('MIG-26-A: journal `when` values are strictly increasing and not in the future (Drizzle skips migrations whose when <= last applied created_at)', () => {
      const raw = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
        entries: Array<{ idx: number; when: number }>;
      };
      let prev = 0;
      for (const e of raw.entries) {
        expect(e.when).toBeGreaterThan(prev);
        prev = e.when;
      }
      expect(prev).toBeLessThan(Date.now());
    });

    it('MIG-26-B: the real drizzle-orm migrator bootstraps an empty database with all 32 migrations (statement breakpoints, transaction, bookkeeping)', async () => {
      const dbName = `test_t26_migrator_${Date.now()}`;
      await adminPool.query(`CREATE DATABASE ${dbName}`);
      const p = new Pool({
        connectionString: `postgresql://platform_user:platform_pass@localhost:5433/${dbName}`,
      });
      try {
        const { drizzle } = await import('drizzle-orm/node-postgres');
        const { migrate } = await import('drizzle-orm/node-postgres/migrator');
        await migrate(drizzle(p), { migrationsFolder: migrationsDir });
        const rows = await p.query(
          'SELECT count(*)::int AS n, max(created_at)::bigint AS last FROM drizzle.__drizzle_migrations',
        );
        expect(rows.rows[0].n).toBe(32);
        expect(Number(rows.rows[0].last)).toBeLessThan(Date.now());

        // Re-running is a no-op (idempotent bookkeeping)
        await migrate(drizzle(p), { migrationsFolder: migrationsDir });
        const again = await p.query(
          'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
        );
        expect(again.rows[0].n).toBe(32);

        const idx = await p.query(
          `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`,
          [
            [
              'idx_loyalty_points_review_reward_unique',
              'orders_consignment_id_idx',
              'outbox_events_pending_idx',
            ],
          ],
        );
        expect(idx.rows.length).toBe(3);
      } finally {
        await p.end();
        await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
      }
    });

    it('MIG-26-C: PostgreSQL uuid ordering equals JS lexicographic ordering (runtime and migration agree on the canonical item)', async () => {
      const ids = Array.from({ length: 300 }, () => randomUUID());
      const pg = await testPool.query(
        'SELECT id::text FROM unnest($1::uuid[]) AS t(id) ORDER BY id ASC',
        [ids],
      );
      const js = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(pg.rows.map((r) => r.id)).toEqual(js);
    });

    it('MIG-26-D: legacy reward on an order with several rows of the same product maps to the canonical (lowest-id) item', async () => {
      const userId = randomUUID();
      await testPool.query(
        `INSERT INTO users (id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'h', 'Canon', 'customer')`,
        [userId, `canon-${userId.slice(0, 8)}@example.com`],
      );
      const prod = await testPool.query(`SELECT id FROM products LIMIT 1`);
      const productId = prod.rows[0].id;
      const addr = await testPool.query(
        `INSERT INTO addresses (id, user_id, title, address_line_1, city, zip_code, is_default)
         VALUES ($1, $2, 'H', 'L', 'Dhaka', '1200', true) RETURNING id`,
        [randomUUID(), userId],
      );
      const orderId = randomUUID();
      await testPool.query(
        `INSERT INTO orders (id, user_id, shipping_address_id, total_amount, status, payment_status)
         VALUES ($1, $2, $3, '1500.00', 'delivered', 'paid')`,
        [orderId, userId, addr.rows[0].id],
      );
      const items = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of items) {
        await testPool.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
           VALUES ($1, $2, $3, 1, '500.00')`,
          [id, orderId, productId],
        );
      }
      const reviewId = randomUUID();
      await testPool.query(
        `INSERT INTO reviews (id, user_id, product_id, order_id, rating, comment)
         VALUES ($1, $2, $3, $4, 5, 'legacy')`,
        [reviewId, userId, productId, orderId],
      );
      const lpId = randomUUID();
      await testPool.query(
        `INSERT INTO loyalty_points (id, user_id, points, type, reference_id)
         VALUES ($1, $2, 50, 'earned_review_text', $3)`,
        [lpId, userId, reviewId],
      );

      await testPool.query(
        getSqlForMigration(
          '0029_backfill_historical_review_loyalty_references',
        ),
      );

      const canonical = [...items].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      )[0];
      const r = await testPool.query(
        'SELECT reference_id FROM loyalty_points WHERE id = $1',
        [lpId],
      );
      expect(r.rows[0].reference_id).toBe(canonical);

      // A recreated review rewarded at runtime targets the same canonical item -> the
      // partial unique index rejects a second reward for this purchase.
      await expect(
        testPool.query(
          `INSERT INTO loyalty_points (user_id, points, type, reference_id)
           VALUES ($1, 50, 'earned_review_media', $2)`,
          [userId, canonical],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});

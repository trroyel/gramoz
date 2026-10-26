import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

describe('Database Migration Integrity (TASK-01)', () => {
  const migration0013Path = path.resolve(
    __dirname,
    '../../../server/drizzle/migrations/0013_flaky_puppet_master.sql',
  );

  describe('Static Migration File Verification', () => {
    it('should exist and contain valid SQL statements', () => {
      expect(fs.existsSync(migration0013Path)).toBe(true);
      const content = fs.readFileSync(migration0013Path, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should safely drop table constraint before dropping index', () => {
      const content = fs.readFileSync(migration0013Path, 'utf-8');

      // Must contain safe DROP CONSTRAINT IF EXISTS
      expect(content).toMatch(
        /ALTER TABLE ["`]?cart_items["`]? DROP CONSTRAINT IF EXISTS ["`]?uq_cart_items_user_product["`]?/i,
      );

      // Must contain safe DROP INDEX IF EXISTS
      expect(content).toMatch(
        /DROP INDEX IF EXISTS ["`]?uq_cart_items_user_product["`]?/i,
      );

      // Must not contain raw, unprotected DROP INDEX without constraint drop
      const lines = content.split('--> statement-breakpoint');
      const rawDropIndexWithoutConstraint = lines.some((stmt) =>
        /^DROP INDEX ["`]?uq_cart_items_user_product["`]?\s*;?$/i.test(
          stmt.trim(),
        ),
      );
      expect(rawDropIndexWithoutConstraint).toBe(false);
    });

    it('should idempotently add variant_id column to cart_items', () => {
      const content = fs.readFileSync(migration0013Path, 'utf-8');
      expect(content).toMatch(
        /ALTER TABLE ["`]?cart_items["`]? ADD COLUMN IF NOT EXISTS ["`]?variant_id["`]? uuid/i,
      );
    });
  });

  describe('PostgreSQL Constraint & Migration Behavior (Integration)', () => {
    let pool: Pool;
    const testDbUrl =
      process.env.DATABASE_URL ||
      'postgresql://platform_user:platform_pass@localhost:5433/test_migration_db';

    beforeAll(async () => {
      pool = new Pool({
        connectionString: testDbUrl,
        connectionTimeoutMillis: 3000,
      });
    });

    afterAll(async () => {
      await pool.end().catch(() => {});
    });

    it('should reproduce the defect: raw DROP INDEX fails when constraint exists', async () => {
      const client = await pool.connect();
      try {
        await client.query('DROP TABLE IF EXISTS test_defect_cart CASCADE;');
        await client.query(`
          CREATE TABLE test_defect_cart (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            product_id uuid NOT NULL
          );
        `);
        await client.query(`
          ALTER TABLE test_defect_cart
            ADD CONSTRAINT uq_test_defect_cart UNIQUE (user_id, product_id);
        `);

        // Attempting to drop the index backing the unique constraint should fail in PostgreSQL
        let error: any = null;
        try {
          await client.query('DROP INDEX uq_test_defect_cart;');
        } catch (err) {
          error = err;
        }

        expect(error).not.toBeNull();
        expect(error.code).toBe('2BP01'); // dependent_objects_still_exist
        expect(error.message).toMatch(
          /cannot drop index uq_test_defect_cart because constraint/i,
        );
      } finally {
        await client
          .query('DROP TABLE IF EXISTS test_defect_cart CASCADE;')
          .catch(() => {});
        client.release();
      }
    });

    it('should verify the solution: DROP CONSTRAINT IF EXISTS succeeds on table constraint', async () => {
      const client = await pool.connect();
      try {
        await client.query('DROP TABLE IF EXISTS test_solution_cart CASCADE;');
        await client.query(`
          CREATE TABLE test_solution_cart (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            product_id uuid NOT NULL
          );
        `);
        await client.query(`
          ALTER TABLE test_solution_cart
            ADD CONSTRAINT uq_test_solution_cart UNIQUE (user_id, product_id);
        `);

        // The safe remediation pattern from TASK-01
        await client.query(
          'ALTER TABLE test_solution_cart DROP CONSTRAINT IF EXISTS uq_test_solution_cart;',
        );
        await client.query('DROP INDEX IF EXISTS uq_test_solution_cart;');
        await client.query(
          'ALTER TABLE test_solution_cart ADD COLUMN IF NOT EXISTS variant_id uuid;',
        );

        // Verify column added and constraint removed
        const res = await client.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = 'test_solution_cart' AND column_name = 'variant_id';
        `);
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].column_name).toBe('variant_id');
      } finally {
        await client
          .query('DROP TABLE IF EXISTS test_solution_cart CASCADE;')
          .catch(() => {});
        client.release();
      }
    });

    it('should be completely idempotent when run multiple times', async () => {
      const client = await pool.connect();
      try {
        await client.query(
          'DROP TABLE IF EXISTS test_idempotent_cart CASCADE;',
        );
        await client.query(`
          CREATE TABLE test_idempotent_cart (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            product_id uuid NOT NULL
          );
        `);

        // Run 1: Neither constraint nor index exists
        await expect(
          client.query(`
            ALTER TABLE test_idempotent_cart DROP CONSTRAINT IF EXISTS uq_test_idempotent_cart;
            DROP INDEX IF EXISTS uq_test_idempotent_cart;
            ALTER TABLE test_idempotent_cart ADD COLUMN IF NOT EXISTS variant_id uuid;
          `),
        ).resolves.not.toThrow();

        // Run 2: Re-run should execute without error (idempotent)
        await expect(
          client.query(`
            ALTER TABLE test_idempotent_cart DROP CONSTRAINT IF EXISTS uq_test_idempotent_cart;
            DROP INDEX IF EXISTS uq_test_idempotent_cart;
            ALTER TABLE test_idempotent_cart ADD COLUMN IF NOT EXISTS variant_id uuid;
          `),
        ).resolves.not.toThrow();
      } finally {
        await client
          .query('DROP TABLE IF EXISTS test_idempotent_cart CASCADE;')
          .catch(() => {});
        client.release();
      }
    });
  });
});

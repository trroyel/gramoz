/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@database/schema';
import { CartStore } from './cart.store';
import { CartService } from './cart.service';
import { InsufficientStockError } from '../../common/errors/domain.errors';

describe('Cart Concurrency Control & Atomic Upsert (PostgreSQL Integration — TASK-06)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let cartStore: CartStore;
  let cartService: CartService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  // Seeded test entities
  let testUserId: string;
  let testOtherUserId: string;
  let testStandardProductId: string;
  let testVariantProductId: string;
  let testVariantAId: string;
  let testVariantBId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 15, // Sufficient pool size for concurrent requests
    });
    db = drizzle(pool, { schema });

    cartStore = new CartStore(db as any);
    cartService = new CartService(cartStore);

    // Create isolated test user
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `cart-test-${Date.now()}@test.gramoz.com`,
        passwordHash: 'dummy-hashed-pass',
        fullName: 'Cart Concurrency Tester',
        status: 'active',
        isEmailVerified: true,
      })
      .returning();
    testUserId = user.id;

    const [otherUser] = await db
      .insert(schema.users)
      .values({
        email: `cart-other-${Date.now()}@test.gramoz.com`,
        passwordHash: 'dummy-hashed-pass',
        fullName: 'Other Cart Tester',
        status: 'active',
        isEmailVerified: true,
      })
      .returning();
    testOtherUserId = otherUser.id;

    // Create a standard product without variants (stock = 100)
    const [standardProd] = await db
      .insert(schema.products)
      .values({
        name: 'Gramoz Test Graphic Tee',
        slug: `cart-test-tee-${Date.now()}`,
        description: 'Testing cart concurrency',
        price: '850.00',
        stock: 100,
        status: 'active',
      })
      .returning();
    testStandardProductId = standardProd.id;

    // Create a product with variants
    const [variantProd] = await db
      .insert(schema.products)
      .values({
        name: 'Gramoz Premium Hoodie',
        slug: `cart-test-hoodie-${Date.now()}`,
        description: 'Testing variant cart concurrency',
        price: '2200.00',
        stock: 50,
        status: 'active',
      })
      .returning();
    testVariantProductId = variantProd.id;

    // Create Variant A (stock = 30)
    const [varA] = await db
      .insert(schema.productVariants)
      .values({
        productId: testVariantProductId,
        sku: `VAR-A-${Date.now()}`,
        price: '2250.00',
        stock: 30,
        attributes: { size: 'M', color: 'Black' },
      })
      .returning();
    testVariantAId = varA.id;

    // Create Variant B (stock = 25)
    const [varB] = await db
      .insert(schema.productVariants)
      .values({
        productId: testVariantProductId,
        sku: `VAR-B-${Date.now()}`,
        price: '2300.00',
        stock: 25,
        attributes: { size: 'L', color: 'Grey' },
      })
      .returning();
    testVariantBId = varB.id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query(
          'DELETE FROM cart_items WHERE user_id IN ($1, $2);',
          [testUserId, testOtherUserId],
        );
        await client.query(
          'DELETE FROM product_variants WHERE product_id = $1;',
          [testVariantProductId],
        );
        await client.query('DELETE FROM products WHERE id IN ($1, $2);', [
          testStandardProductId,
          testVariantProductId,
        ]);
        await client.query('DELETE FROM users WHERE id IN ($1, $2);', [
          testUserId,
          testOtherUserId,
        ]);
      } finally {
        client.release();
        await pool.end();
      }
    }
  });

  beforeEach(async () => {
    // Clean cart before each test scenario
    await cartService.clearCart(testUserId);
    await cartService.clearCart(testOtherUserId);
  });

  describe('PostgreSQL Constraint Enforcement & NULL Semantics', () => {
    it('should reject duplicate standard product insertions via direct SQL with unique_violation', async () => {
      const client = await pool.connect();
      try {
        // Insert standard product (variant_id is NULL)
        await client.query(
          `INSERT INTO cart_items (user_id, product_id, variant_id, quantity)
           VALUES ($1, $2, NULL, 1);`,
          [testUserId, testStandardProductId],
        );

        // Attempt direct insert of duplicate row without ON CONFLICT
        let err: any = null;
        try {
          await client.query(
            `INSERT INTO cart_items (user_id, product_id, variant_id, quantity)
             VALUES ($1, $2, NULL, 1);`,
            [testUserId, testStandardProductId],
          );
        } catch (e) {
          err = e;
        }

        expect(err).not.toBeNull();
        expect(err.code).toBe('23505'); // unique_violation in PostgreSQL
        expect(err.constraint).toBe('uq_cart_items_user_product_variant');
      } finally {
        client.release();
      }
    });

    it('should reject duplicate variant insertions via direct SQL with unique_violation', async () => {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO cart_items (user_id, product_id, variant_id, quantity)
           VALUES ($1, $2, $3, 1);`,
          [testUserId, testVariantProductId, testVariantAId],
        );

        let err: any = null;
        try {
          await client.query(
            `INSERT INTO cart_items (user_id, product_id, variant_id, quantity)
             VALUES ($1, $2, $3, 2);`,
            [testUserId, testVariantProductId, testVariantAId],
          );
        } catch (e) {
          err = e;
        }

        expect(err).not.toBeNull();
        expect(err.code).toBe('23505'); // unique_violation
        expect(err.constraint).toBe('uq_cart_items_user_product_variant');
      } finally {
        client.release();
      }
    });
  });

  describe('Sequential Additions and Accumulation', () => {
    it('should add a standard product and accumulate quantity on subsequent additions', async () => {
      const item1 = await cartService.addItem(testUserId, {
        productId: testStandardProductId,
        quantity: 2,
      });
      expect(item1.quantity).toBe(2);
      expect(item1.variantId).toBeNull();

      const item2 = await cartService.addItem(testUserId, {
        productId: testStandardProductId,
        quantity: 3,
      });
      expect(item2.id).toBe(item1.id); // Same row ID
      expect(item2.quantity).toBe(5); // 2 + 3 = 5

      // Check PostgreSQL actual rows
      const dbRows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, testUserId));

      expect(dbRows.length).toBe(1);
      expect(dbRows[0].quantity).toBe(5);
    });

    it('should allow multiple different variants of the same product to coexist as separate rows', async () => {
      // Add Variant A
      const itemA = await cartService.addItem(testUserId, {
        productId: testVariantProductId,
        variantId: testVariantAId,
        quantity: 1,
      });

      // Add Variant B
      const itemB = await cartService.addItem(testUserId, {
        productId: testVariantProductId,
        variantId: testVariantBId,
        quantity: 2,
      });

      expect(itemA.id).not.toBe(itemB.id);

      // Verify cart contents in DB
      const cart = await cartService.getCart(testUserId);
      expect(cart.itemCount).toBe(2);

      const dbRows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, testUserId));

      expect(dbRows.length).toBe(2);
      const rowA = dbRows.find((r) => r.variantId === testVariantAId);
      const rowB = dbRows.find((r) => r.variantId === testVariantBId);
      expect(rowA?.quantity).toBe(1);
      expect(rowB?.quantity).toBe(2);
    });
  });

  describe('High-Concurrency Race Conditions (Promise.all)', () => {
    it('Race 1: Concurrent additions to an empty cart must produce exactly 1 row with accumulated quantity', async () => {
      // 10 concurrent requests to add 1 unit of standard product to empty cart
      const concurrencyLevel = 10;
      const requests = Array.from({ length: concurrencyLevel }).map(() =>
        cartService.addItem(testUserId, {
          productId: testStandardProductId,
          quantity: 1,
        }),
      );

      const results = await Promise.all(requests);
      expect(results.length).toBe(concurrencyLevel);

      // All returned items must have the same row ID
      const firstId = results[0].id;
      const allSameId = results.every((r) => r.id === firstId);
      expect(allSameId).toBe(true);

      // Direct PostgreSQL query verification
      const dbRows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, testUserId));

      expect(dbRows.length).toBe(1); // EXACTLY ONE ROW
      expect(dbRows[0].quantity).toBe(10); // EXACTLY 10 UNITS
    });

    it('Race 2: Concurrent additions to an existing cart must preserve existing quantity and add increments', async () => {
      // Initial cart state: 4 units
      const initial = await cartService.addItem(testUserId, {
        productId: testStandardProductId,
        quantity: 4,
      });
      expect(initial.quantity).toBe(4);

      // 6 concurrent requests each adding 3 units
      const concurrencyLevel = 6;
      const requests = Array.from({ length: concurrencyLevel }).map(() =>
        cartService.addItem(testUserId, {
          productId: testStandardProductId,
          quantity: 3,
        }),
      );

      const results = await Promise.all(requests);
      expect(results.length).toBe(concurrencyLevel);

      // Verify final database state: 4 + (6 * 3) = 22
      const dbRows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, testUserId));

      expect(dbRows.length).toBe(1);
      expect(dbRows[0].id).toBe(initial.id);
      expect(dbRows[0].quantity).toBe(22);
    });

    it('Race 3: Mixed concurrent additions across multiple variants must aggregate each variant independently', async () => {
      // 6 requests for Variant A (quantity 2 each -> total 12)
      // 4 requests for Variant B (quantity 3 each -> total 12)
      const varARequests = Array.from({ length: 6 }).map(() =>
        cartService.addItem(testUserId, {
          productId: testVariantProductId,
          variantId: testVariantAId,
          quantity: 2,
        }),
      );

      const varBRequests = Array.from({ length: 4 }).map(() =>
        cartService.addItem(testUserId, {
          productId: testVariantProductId,
          variantId: testVariantBId,
          quantity: 3,
        }),
      );

      // Fire all 10 simultaneously
      await Promise.all([...varARequests, ...varBRequests]);

      const dbRows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, testUserId));

      expect(dbRows.length).toBe(2);

      const rowA = dbRows.find((r) => r.variantId === testVariantAId);
      const rowB = dbRows.find((r) => r.variantId === testVariantBId);

      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();
      expect(rowA?.quantity).toBe(12); // 6 * 2 = 12
      expect(rowB?.quantity).toBe(12); // 4 * 3 = 12
    });

    it('Race 4: Stock ceiling under high concurrency must prevent total cart quantity from exceeding stock', async () => {
      // Create a scarce product with stock = 5
      const [scarceProd] = await db
        .insert(schema.products)
        .values({
          name: 'Limited Edition Sneakers',
          slug: `scarce-prod-${Date.now()}`,
          description: 'Testing stock limit concurrency',
          price: '5500.00',
          stock: 5,
          status: 'active',
        })
        .returning();

      try {
        // 5 concurrent requests each trying to add 2 units (demanding 10 total for stock 5)
        const requests = Array.from({ length: 5 }).map(async () => {
          try {
            await cartService.addItem(testUserId, {
              productId: scarceProd.id,
              quantity: 2,
            });
            return { success: true, isInsufficientStock: false };
          } catch (err: any) {
            return {
              success: false,
              isInsufficientStock: err instanceof InsufficientStockError,
            };
          }
        });

        const outcomes = await Promise.all(requests);

        const successes = outcomes.filter((o) => o.success);
        const failures = outcomes.filter((o) => !o.success);

        // Exactly 2 requests can succeed (2 * 2 = 4 units <= 5; 3rd would be 6 > 5)
        expect(successes.length).toBe(2);
        expect(failures.length).toBe(3);
        failures.forEach((f) => expect(f.isInsufficientStock).toBe(true));

        // Check final quantity in DB: exactly 4, NEVER exceeding 5
        const dbRows = await db
          .select()
          .from(schema.cartItems)
          .where(
            sql`${schema.cartItems.userId} = ${testUserId} AND ${schema.cartItems.productId} = ${scarceProd.id}`,
          );

        expect(dbRows.length).toBe(1);
        expect(dbRows[0].quantity).toBe(4);
      } finally {
        await db
          .delete(schema.cartItems)
          .where(eq(schema.cartItems.productId, scarceProd.id));
        await db
          .delete(schema.products)
          .where(eq(schema.products.id, scarceProd.id));
      }
    });

    it('Race 5: Multiple users concurrently adding the same product must not collide', async () => {
      // User 1 and User 2 concurrently add the same standard product
      const [resUser1, resUser2] = await Promise.all([
        cartService.addItem(testUserId, {
          productId: testStandardProductId,
          quantity: 3,
        }),
        cartService.addItem(testOtherUserId, {
          productId: testStandardProductId,
          quantity: 7,
        }),
      ]);

      expect(resUser1.userId).toBe(testUserId);
      expect(resUser1.quantity).toBe(3);

      expect(resUser2.userId).toBe(testOtherUserId);
      expect(resUser2.quantity).toBe(7);

      const rowsUser1 = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, testUserId));

      const rowsUser2 = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, testOtherUserId));

      expect(rowsUser1.length).toBe(1);
      expect(rowsUser1[0].quantity).toBe(3);

      expect(rowsUser2.length).toBe(1);
      expect(rowsUser2[0].quantity).toBe(7);
    });
  });

  describe('Cart CRUD & Cleanup Operations against PostgreSQL', () => {
    it('should update cart item quantity and reflect in getCart totals', async () => {
      const item = await cartService.addItem(testUserId, {
        productId: testStandardProductId,
        quantity: 2,
      });

      const updated = await cartService.updateItem(testUserId, item.id, 8);
      expect(updated.quantity).toBe(8);

      const cart = await cartService.getCart(testUserId);
      expect(cart.itemCount).toBe(1);
      // 8 * 850.00 = 6800.00
      expect(cart.subtotal).toBe('6800.00');
    });

    it('should remove a single item from the cart', async () => {
      const item1 = await cartService.addItem(testUserId, {
        productId: testStandardProductId,
        quantity: 1,
      });
      const item2 = await cartService.addItem(testUserId, {
        productId: testVariantProductId,
        variantId: testVariantAId,
        quantity: 1,
      });

      await cartService.removeItem(testUserId, item1.id);

      const cart = await cartService.getCart(testUserId);
      expect(cart.itemCount).toBe(1);
      expect(cart.items[0].id).toBe(item2.id);
    });

    it('should clear all items in the cart', async () => {
      await cartService.addItem(testUserId, {
        productId: testStandardProductId,
        quantity: 1,
      });
      await cartService.addItem(testUserId, {
        productId: testVariantProductId,
        variantId: testVariantAId,
        quantity: 1,
      });

      await cartService.clearCart(testUserId);

      const cart = await cartService.getCart(testUserId);
      expect(cart.itemCount).toBe(0);
      expect(cart.subtotal).toBe('0.00');
    });
  });

  describe('Transaction Rollback Semantics', () => {
    it('should roll back cart insertions if a transaction aborts', async () => {
      let aborted = false;
      try {
        await db.transaction(async (tx) => {
          await cartStore.upsertCartItem(
            {
              userId: testUserId,
              productId: testStandardProductId,
              variantId: null,
              quantity: 5,
            },
            100,
            tx,
          );
          // Force transaction abort
          throw new Error('Simulated mid-transaction failure');
        });
      } catch {
        aborted = true;
      }

      expect(aborted).toBe(true);

      // Cart must remain completely empty in PostgreSQL
      const dbRows = await db
        .select()
        .from(schema.cartItems)
        .where(eq(schema.cartItems.userId, testUserId));

      expect(dbRows.length).toBe(0);
    });
  });
});

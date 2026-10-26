import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/database/schema';
import { CartStore } from '../../src/modules/cart/cart.store';
import { CartService } from '../../src/modules/cart/cart.service';

async function runCartUpsertRaceTest() {
  console.log(
    '🚀 Starting CONC-02: Cart Duplicate Addition Race Test against PostgreSQL...',
  );

  const dbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const pool = new Pool({
    connectionString: dbUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
  });

  const db = drizzle(pool, { schema });
  const cartStore = new CartStore(db as any);
  const cartService = new CartService(cartStore);

  let userId: string = '';
  let productId: string = '';
  let variantId: string = '';
  let standardProductId: string = '';

  try {
    // 1. Seed isolated test data
    console.log('📦 Seeding isolated test entities...');
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `race-test-${Date.now()}@test.gramoz.com`,
        passwordHash: 'dummy-hash',
        fullName: 'Concurrency Race Tester',
        status: 'active',
        isEmailVerified: true,
      })
      .returning();
    userId = user.id;

    const [prod] = await db
      .insert(schema.products)
      .values({
        name: 'Race Polo Shirt',
        slug: `race-polo-${Date.now()}`,
        description: 'Concurrency test product',
        price: '1500.00',
        stock: 50,
        status: 'active',
      })
      .returning();
    productId = prod.id;

    const [variant] = await db
      .insert(schema.productVariants)
      .values({
        productId: prod.id,
        sku: `POLO-M-NVY-${Date.now()}`,
        price: '1550.00',
        stock: 50,
        attributes: { size: 'M', color: 'Navy' },
      })
      .returning();
    variantId = variant.id;

    const [stdProd] = await db
      .insert(schema.products)
      .values({
        name: 'Standard Graphic Tee (No Variant)',
        slug: `race-tee-${Date.now()}`,
        description: 'Standard product without variants',
        price: '850.00',
        stock: 50,
        status: 'active',
      })
      .returning();
    standardProductId = stdProd.id;

    // 2. Scenario A: Variant product race (5 simultaneous requests, qty = 1 each)
    console.log(
      '⚡ Firing 5 simultaneous Add to Cart requests for product variant...',
    );
    const variantPromises = Array.from({ length: 5 }).map(() =>
      cartService.addItem(userId, {
        productId,
        variantId,
        quantity: 1,
      }),
    );

    const variantResults = await Promise.all(variantPromises);
    console.log(
      `✅ All ${variantResults.length} requests completed successfully.`,
    );

    // Direct database assertions
    const dbVariantRows = await db
      .select()
      .from(schema.cartItems)
      .where(eq(schema.cartItems.userId, userId));

    const variantItem = dbVariantRows.find((r) => r.variantId === variantId);

    console.log('🔍 Database verification for variant item:');
    console.log(
      `   - Total rows in cart for user: ${dbVariantRows.length} (Expected: 1)`,
    );
    console.log(
      `   - Aggregated quantity: ${variantItem?.quantity} (Expected: 5)`,
    );

    if (dbVariantRows.length !== 1) {
      throw new Error(
        `ASSERTION FAILED: Expected exactly 1 cart row for variant, found ${dbVariantRows.length}!`,
      );
    }

    if (!variantItem || variantItem.quantity !== 5) {
      throw new Error(
        `ASSERTION FAILED: Expected quantity to be 5, found ${variantItem?.quantity}!`,
      );
    }

    // 3. Scenario B: Standard product without variant (NULL variant_id race)
    console.log(
      '⚡ Firing 5 simultaneous Add to Cart requests for standard product (NULL variant)...',
    );
    const stdPromises = Array.from({ length: 5 }).map(() =>
      cartService.addItem(userId, {
        productId: standardProductId,
        quantity: 1,
      }),
    );

    const stdResults = await Promise.all(stdPromises);
    console.log(`✅ All ${stdResults.length} requests completed successfully.`);

    const dbAllRows = await db
      .select()
      .from(schema.cartItems)
      .where(eq(schema.cartItems.userId, userId));

    const stdItem = dbAllRows.find((r) => r.productId === standardProductId);

    console.log('🔍 Database verification for standard product item:');
    console.log(
      `   - Total rows in cart for user: ${dbAllRows.length} (Expected: 2)`,
    );
    console.log(
      `   - Standard item quantity: ${stdItem?.quantity} (Expected: 5)`,
    );

    if (dbAllRows.length !== 2) {
      throw new Error(
        `ASSERTION FAILED: Expected exactly 2 total cart rows (1 variant + 1 standard), found ${dbAllRows.length}!`,
      );
    }

    if (!stdItem || stdItem.quantity !== 5) {
      throw new Error(
        `ASSERTION FAILED: Expected standard item quantity to be 5, found ${stdItem?.quantity}!`,
      );
    }

    console.log(
      '🎉 CONC-02 PASSED: Zero duplicate cart rows, atomic upsert correctly aggregated all quantities!',
    );
  } finally {
    // Cleanup
    console.log('🧹 Cleaning up test entities from PostgreSQL...');
    if (userId) {
      await db
        .delete(schema.cartItems)
        .where(eq(schema.cartItems.userId, userId));
      await db
        .delete(schema.productVariants)
        .where(eq(schema.productVariants.id, variantId));
      await db.delete(schema.products).where(eq(schema.products.id, productId));
      await db
        .delete(schema.products)
        .where(eq(schema.products.id, standardProductId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    await pool.end();
  }
}

runCartUpsertRaceTest().catch((err) => {
  console.error('❌ CONC-02 Race Test Failed:', err);
  process.exit(1);
});

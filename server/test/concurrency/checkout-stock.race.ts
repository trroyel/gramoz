/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/require-await */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/database/schema';
import { OrdersStore } from '../../src/modules/orders/orders.store';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PromosService } from '../../src/modules/promos/promos.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyStore } from '../../src/modules/loyalty/loyalty.store';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SettingsStore } from '../../src/modules/settings/settings.store';
import { CourierService } from '../../src/modules/courier/courier.service';
import { InsufficientStockError } from '../../src/common/errors/domain.errors';

async function runCheckoutStockRaceTest() {
  console.log(
    '🚀 Starting CONC-03: Checkout Overselling Prevention Race Test against PostgreSQL...',
  );

  const dbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const pool = new Pool({
    connectionString: dbUrl,
    max: 15,
    connectionTimeoutMillis: 5000,
  });

  const db = drizzle(pool, { schema });
  const ordersStore = new OrdersStore(db as any);
  const loyaltyStore = new LoyaltyStore(db as any);
  const settingsStore = new SettingsStore(db as any);
  const settingsService = new SettingsService(settingsStore);
  const loyaltyService = new LoyaltyService(loyaltyStore, settingsService);

  const mockPromosService = {
    validate: async () => ({ promoId: null, discountAmount: 0 }),
  } as unknown as PromosService;

  const mockCourierService = {
    calculateCharge: async () => ({ charge: 60, estimatedDays: '2-3' }),
    createConsignment: async () => ({ tracking_code: 'TRK-RACE' }),
  } as unknown as CourierService;

  const ordersService = new OrdersService(
    ordersStore,
    mockPromosService,
    loyaltyService,
    settingsService,
    mockCourierService,
  );

  const createdUserIds: string[] = [];
  let categoryId: string = '';
  let limitedProductId: string = '';

  try {
    console.log('📦 Seeding isolated test entities...');
    const [cat] = await db
      .insert(schema.categories)
      .values({
        name: `Race Category ${Date.now()}`,
        slug: `race-cat-${Date.now()}`,
      })
      .returning();
    categoryId = cat.id;

    // Seed product with EXACTLY 1 unit of stock
    const [prod] = await db
      .insert(schema.products)
      .values({
        name: 'Rare Final Edition Watch',
        slug: `rare-watch-${Date.now()}`,
        description: 'Single-stock item to test overselling prevention',
        price: '4500.00',
        stock: 1,
        categoryId: cat.id,
        status: 'active',
      })
      .returning();
    limitedProductId = prod.id;

    // Create 5 distinct buyers and add 1 item to each cart
    for (let i = 0; i < 5; i++) {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `chk_race_buyer_${i}_${Date.now()}@test.gramoz.com`,
          passwordHash: 'dummy-hash',
          fullName: `Race Buyer ${i}`,
          phone: `0171100000${i}`,
          isPhoneVerified: true,
          status: 'active',
        })
        .returning();
      createdUserIds.push(user.id);

      await db.insert(schema.cartItems).values({
        userId: user.id,
        productId: prod.id,
        variantId: null,
        quantity: 1,
      });
    }

    console.log(
      '⚡ Firing 5 simultaneous checkout requests from 5 distinct buyers competing for 1 item...',
    );
    const results = await Promise.allSettled(
      createdUserIds.map((uid) =>
        ordersService.createOrderFromCart(
          uid,
          {
            addressLine1: 'Race Avenue 10',
            city: 'Dhaka',
            phone: '01711000000',
          },
          `race_key_${uid}_${Date.now()}`,
        ),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    console.log(
      `📊 Results: ${fulfilled.length} fulfilled, ${rejected.length} rejected.`,
    );

    if (fulfilled.length !== 1) {
      throw new Error(
        `CRITICAL FAILURE: Expected exactly 1 successful checkout, got ${fulfilled.length}`,
      );
    }

    if (rejected.length !== 4) {
      throw new Error(
        `CRITICAL FAILURE: Expected exactly 4 rejected checkouts, got ${rejected.length}`,
      );
    }

    for (const rej of rejected) {
      const reason = rej.reason;
      if (!(reason instanceof InsufficientStockError)) {
        throw new Error(
          `Expected InsufficientStockError, but got: ${String(reason)}`,
        );
      }
    }

    // Database boundary verification
    console.log('🔍 Verifying PostgreSQL storage invariants...');
    const [finalProd] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, limitedProductId));

    if (finalProd.stock !== 0) {
      throw new Error(
        `Database invariant violated: Expected stock = 0, got ${finalProd.stock}`,
      );
    }

    const orderItemsCount = await pool.query(
      'SELECT count(*) FROM order_items WHERE product_id = $1',
      [limitedProductId],
    );

    if (parseInt(orderItemsCount.rows[0].count, 10) !== 1) {
      throw new Error(
        `Database invariant violated: Expected 1 order item, got ${orderItemsCount.rows[0].count}`,
      );
    }

    console.log(
      '🎉 CONC-03 PASSED: Exactly 1 buyer succeeded, 4 failed gracefully, stock reached 0 without overselling!',
    );
  } finally {
    console.log('🧹 Cleaning up test entities from PostgreSQL...');
    try {
      if (limitedProductId) {
        await pool.query('DELETE FROM order_items WHERE product_id = $1', [
          limitedProductId,
        ]);
        await pool.query('DELETE FROM cart_items WHERE product_id = $1', [
          limitedProductId,
        ]);
        await pool.query(
          'DELETE FROM inventory_transactions WHERE product_id = $1',
          [limitedProductId],
        );
        await pool.query('DELETE FROM products WHERE id = $1', [
          limitedProductId,
        ]);
      }
      if (categoryId) {
        await pool.query('DELETE FROM categories WHERE id = $1', [categoryId]);
      }
      for (const uid of createdUserIds) {
        await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1', [
          uid,
        ]);
        await pool.query(
          'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)',
          [uid],
        );
        await pool.query('DELETE FROM orders WHERE user_id = $1', [uid]);
        await pool.query('DELETE FROM cart_items WHERE user_id = $1', [uid]);
        await pool.query('DELETE FROM addresses WHERE user_id = $1', [uid]);
        await pool.query('DELETE FROM users WHERE id = $1', [uid]);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }
    await pool.end().catch(() => {});
  }
}

runCheckoutStockRaceTest().catch((err) => {
  console.error('❌ CONC-03 Test Failed:', err);
  process.exit(1);
});

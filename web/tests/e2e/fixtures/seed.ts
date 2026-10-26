import { Pool } from 'pg';

export const E2E_PASSWORD = 'Password123!';
export const E2E_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$roM2xaLPGg4bts7iq9NRTw$8v++dZWUyXTEBxNuMu0QlKd6hngFxT1R41GbqprRzFQ';

export const TEST_USERS = {
  customer: {
    id: 'c0000000-0000-4000-8000-000000000001',
    email: 'e2e-customer@gramoz.test',
    password: E2E_PASSWORD,
    fullName: 'E2E Customer',
    phone: '01700000001',
    role: 'customer',
  },
  customer2: {
    id: 'c0000000-0000-4000-8000-000000000002',
    email: 'e2e-customer2@gramoz.test',
    password: E2E_PASSWORD,
    fullName: 'E2E Customer Two',
    phone: '01700000002',
    role: 'customer',
  },
  admin: {
    id: 'a0000000-0000-4000-8000-000000000001',
    email: 'e2e-admin@gramoz.test',
    password: E2E_PASSWORD,
    fullName: 'E2E Administrator',
    phone: '01700000003',
    role: 'admin',
  },
  suspended: {
    id: 'c0000000-0000-4000-8000-000000000009',
    email: 'e2e-suspended@gramoz.test',
    password: E2E_PASSWORD,
    fullName: 'E2E Suspended User',
    phone: '01700000009',
    role: 'customer',
    status: 'suspended',
  },
};

export const TEST_CATEGORY = {
  id: 'b0000000-0000-4000-8000-000000000001',
  name: 'E2E Handicrafts',
  slug: 'e2e-handicrafts',
  description: 'Handcrafted Bangladeshi items for automated testing',
};

export const TEST_PRODUCTS = {
  inStock: {
    id: 'e2e00000-0000-4000-8000-000000000001',
    name: 'E2E Nakshi Kantha Quilt',
    slug: 'e2e-nakshi-kantha-quilt',
    description: 'Authentic handcrafted Bangladeshi Nakshi Kantha quilt with traditional embroidery.',
    price: '1500.00',
    stock: 25,
    unit: 'piece',
    images: ['https://images.unsplash.com/photo-1544441893-675973e31985'],
    status: 'active',
  },
  variant1: {
    id: 'e2e10000-0000-4000-8000-000000000001',
    productId: 'e2e00000-0000-4000-8000-000000000001',
    sku: 'E2E-NK-RED',
    price: '1550.00',
    stock: 10,
    attributes: { Color: 'Crimson Red' },
  },
  variant2: {
    id: 'e2e10000-0000-4000-8000-000000000002',
    productId: 'e2e00000-0000-4000-8000-000000000001',
    sku: 'E2E-NK-BLUE',
    price: '1600.00',
    stock: 15,
    attributes: { Color: 'Indigo Blue' },
  },
  pottery: {
    id: 'e2e00000-0000-4000-8000-000000000002',
    name: 'E2E Clay Pottery Vase',
    slug: 'e2e-clay-pottery-vase',
    description: 'Traditional rural clay vase crafted by heritage artisans.',
    price: '400.00',
    stock: 30,
    unit: 'piece',
    images: ['https://images.unsplash.com/photo-1578749556568-bc2c40e68b61'],
    status: 'active',
  },
  outOfStock: {
    id: 'e2e00000-0000-4000-8000-000000000003',
    name: 'E2E Out of Stock Pottery',
    slug: 'e2e-out-of-stock-pottery',
    description: 'Sold-out handcrafted pottery piece for out-of-stock testing.',
    price: '350.00',
    stock: 0,
    unit: 'piece',
    images: ['https://images.unsplash.com/photo-1523275335684-37898b6baf30'],
    status: 'active',
  },
};

export const TEST_SHIPPING = {
  division: {
    id: 'd0000000-0000-4000-8000-000000000001',
    name: 'Dhaka',
  },
  district: {
    id: 'd1000000-0000-4000-8000-000000000001',
    divisionId: 'd0000000-0000-4000-8000-000000000001',
    name: 'Dhaka',
  },
  zone: {
    id: 'd2000000-0000-4000-8000-000000000001',
    districtId: 'd1000000-0000-4000-8000-000000000001',
    name: 'Dhanmondi',
    homeDeliveryCharge: '60.00',
    branchPickupCharge: '40.00',
  },
};

export function getDbPool(): Pool {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://platform_user:platform_pass@localhost:5433/platform_db',
    max: 5,
    connectionTimeoutMillis: 5000,
  });
}

/**
 * Seeds disposable, deterministic test fixtures into PostgreSQL.
 * Safe for idempotency (uses ON CONFLICT DO UPDATE).
 */
export async function seedE2EFixtures(): Promise<void> {
  const pool = getDbPool();

  try {
    // 1. Seed Users
    for (const u of Object.values(TEST_USERS)) {
      await pool.query(
        `
        INSERT INTO users (id, email, password_hash, full_name, phone, role, status, is_email_verified, is_phone_verified)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)
        ON CONFLICT (email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          is_email_verified = true,
          is_phone_verified = true,
          full_name = EXCLUDED.full_name,
          phone = EXCLUDED.phone,
          created_at = NOW(),
          updated_at = NOW();
      `,
        [
          u.id,
          u.email,
          E2E_PASSWORD_HASH,
          u.fullName,
          u.phone,
          u.role,
          (u as any).status || 'active',
        ],
      );
    }

    // 2. Seed Category
    await pool.query(
      `
      INSERT INTO categories (id, name, slug, description)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description;
    `,
      [TEST_CATEGORY.id, TEST_CATEGORY.name, TEST_CATEGORY.slug, TEST_CATEGORY.description],
    );

    // 3. Seed Products
    for (const p of [TEST_PRODUCTS.inStock, TEST_PRODUCTS.pottery, TEST_PRODUCTS.outOfStock]) {
      await pool.query(
        `
        INSERT INTO products (id, name, slug, description, price, stock, unit, images, category_id, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          stock = EXCLUDED.stock,
          unit = EXCLUDED.unit,
          images = EXCLUDED.images,
          status = EXCLUDED.status,
          created_at = NOW(),
          updated_at = NOW();
      `,
        [
          p.id,
          p.name,
          p.slug,
          p.description,
          p.price,
          p.stock,
          p.unit,
          JSON.stringify(p.images),
          TEST_CATEGORY.id,
          p.status,
        ],
      );
    }

    // 4. Seed Product Variants
    for (const v of [TEST_PRODUCTS.variant1, TEST_PRODUCTS.variant2]) {
      await pool.query(
        `
        INSERT INTO product_variants (id, product_id, sku, price, stock, attributes)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          sku = EXCLUDED.sku,
          price = EXCLUDED.price,
          stock = EXCLUDED.stock,
          attributes = EXCLUDED.attributes;
      `,
        [v.id, v.productId, v.sku, v.price, v.stock, JSON.stringify(v.attributes)],
      );
    }

    // 5. Seed Shipping Division, District, Zone
    await pool.query(`
      INSERT INTO divisions (id, name, is_active)
      VALUES ($1, $2, true)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
    `, [TEST_SHIPPING.division.id, TEST_SHIPPING.division.name]);

    await pool.query(`
      INSERT INTO districts (id, division_id, name, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
    `, [TEST_SHIPPING.district.id, TEST_SHIPPING.district.divisionId, TEST_SHIPPING.district.name]);

    await pool.query(`
      INSERT INTO zones (id, district_id, name, home_delivery_charge, branch_pickup_charge, estimated_days, is_active)
      VALUES ($1, $2, $3, $4, $5, '2-3 days', true)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        home_delivery_charge = EXCLUDED.home_delivery_charge,
        branch_pickup_charge = EXCLUDED.branch_pickup_charge;
    `, [
      TEST_SHIPPING.zone.id,
      TEST_SHIPPING.zone.districtId,
      TEST_SHIPPING.zone.name,
      TEST_SHIPPING.zone.homeDeliveryCharge,
      TEST_SHIPPING.zone.branchPickupCharge,
    ]);

    // 6. Seed Address for Customer
    await pool.query(
      `
      INSERT INTO addresses (id, user_id, title, address_line_1, city, zip_code, zone_id, is_default)
      VALUES ('a1000000-0000-4000-8000-000000000001', $1, 'Home', 'House 42, Road 7, Dhanmondi', 'Dhaka', '1205', $2, true)
      ON CONFLICT (id) DO UPDATE SET
        address_line_1 = EXCLUDED.address_line_1,
        city = EXCLUDED.city,
        zone_id = EXCLUDED.zone_id,
        is_default = true;
    `,
      [TEST_USERS.customer.id, TEST_SHIPPING.zone.id],
    );
    // 7. Clear any stale rate-limiting throttler keys in Redis
    await clearRedisThrottleKeys();
  } finally {
    await pool.end();
  }
}

/**
 * Flushes rate-limiting throttle keys from Redis to prevent E2E test runs
 * from being throttled by concurrent or rapid test requests.
 */
export async function clearRedisThrottleKeys(): Promise<void> {
  const net = await import('net');
  return new Promise<void>((resolve) => {
    const client = net.createConnection({ port: 6380, host: 'localhost' }, () => {
      client.write(
        'AUTH redis_pass\r\nEVAL "for _,k in ipairs(redis.call(\'keys\',\'*throttle*\')) do redis.call(\'del\',k) end" 0\r\nQUIT\r\n',
      );
    });
    client.on('data', () => {});
    client.on('end', () => resolve());
    client.on('error', () => resolve()); // fail-safe: continue even if Redis is unreachable
    setTimeout(() => {
      client.destroy();
      resolve();
    }, 2000);
  });
}

/**
 * Cleans up temporary E2E test data (carts, test orders) without deleting shared base fixtures.
 */
export async function cleanupE2EUserData(userId: string): Promise<void> {
  const pool = getDbPool();
  try {
    await pool.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM wishlists WHERE user_id = $1', [userId]);
    // Find orders for this user and delete dependent payments/order_items if any
    const ordersRes = await pool.query('SELECT id FROM orders WHERE user_id = $1', [userId]);
    for (const row of ordersRes.rows) {
      await pool.query('DELETE FROM payments WHERE order_id = $1', [row.id]);
      await pool.query('DELETE FROM order_items WHERE order_id = $1', [row.id]);
    }
    await pool.query('DELETE FROM orders WHERE user_id = $1', [userId]);
  } finally {
    await pool.end();
  }
}

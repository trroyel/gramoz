import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import {
  seedE2EFixtures,
  TEST_USERS,
  TEST_PRODUCTS,
} from './fixtures/seed';
import { loginAsAdmin, loginAsCustomer } from './helpers/auth-helper';

test.describe('E2E — Refunds & Customer Return Management (TASK-22)', () => {
  let pool: Pool;

  test.beforeAll(async () => {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://platform_user:platform_pass@localhost:5433/platform_db',
    });
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test.beforeEach(async () => {
    await seedE2EFixtures();
  });

  test('Customer accesses /dashboard/refunds and views refunds dashboard', async ({
    page,
  }) => {
    await loginAsCustomer(page);

    await page.goto('/dashboard/refunds');
    await page.waitForLoadState('domcontentloaded');

    // Header verification
    await expect(page.getByRole('heading', { name: 'My Refunds' })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText('Track the status of your refund requests.'),
    ).toBeVisible();
  });

  test('Admin accesses /admin/refunds and views refund management dashboard', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto('/admin/refunds');
    await page.waitForLoadState('domcontentloaded');

    // Admin header verification
    await expect(
      page.getByRole('heading', { name: 'Refund Management' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText('Process and review customer refund requests.'),
    ).toBeVisible();
  });

  test('Customer with seeded refund request sees pending status in /dashboard/refunds', async ({
    page,
  }) => {
    // Seed a delivered order and a refund request for customer
    const client = await pool.connect();
    let orderId: string;
    let refundId: string;

    try {
      // Find address
      const addrRes = await client.query(
        `SELECT id FROM addresses WHERE user_id = $1 LIMIT 1`,
        [TEST_USERS.customer.id],
      );
      const addressId = addrRes.rows[0]?.id;

      // Insert delivered order
      const orderRes = await client.query(
        `INSERT INTO orders (user_id, status, payment_status, total_amount, shipping_address_id)
         VALUES ($1, 'delivered', 'paid', '1500.00', $2)
         RETURNING id`,
        [TEST_USERS.customer.id, addressId],
      );
      orderId = orderRes.rows[0].id;

      // Insert order item
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, 1, '1500.00')`,
        [orderId, TEST_PRODUCTS.inStock.id],
      );

      // Insert payment
      const payRes = await client.query(
        `INSERT INTO payments (order_id, amount, status, method, transaction_id)
         VALUES ($1, '1500.00', 'completed', 'COD', $2)
         RETURNING id`,
        [orderId, `TRN_E2E_${Date.now()}`],
      );
      const paymentId = payRes.rows[0].id;

      // Insert refund
      const refRes = await client.query(
        `INSERT INTO refunds (order_id, payment_id, requested_by, amount, reason, notes, status)
         VALUES ($1, $2, $3, '1500.00', 'wrong_item', 'Wrong size sent', 'requested')
         RETURNING id`,
        [orderId, paymentId, TEST_USERS.customer.id],
      );
      refundId = refRes.rows[0].id;
    } finally {
      client.release();
    }

    try {
      await loginAsCustomer(page);
      await page.goto('/dashboard/refunds');
      await page.waitForLoadState('domcontentloaded');

      // The refund record should be visible with status requested
      await expect(page.getByText('Wrong Item')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('1,500.00').or(page.getByText('1500'))).toBeVisible();
    } finally {
      // Cleanup
      await pool.query(`DELETE FROM refunds WHERE id = $1`, [refundId]);
      await pool.query(`DELETE FROM payments WHERE order_id = $1`, [orderId]);
      await pool.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);
      await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
    }
  });
});

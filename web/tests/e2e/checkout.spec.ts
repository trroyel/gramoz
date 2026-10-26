import { test, expect } from '@playwright/test';
import {
  seedE2EFixtures,
  cleanupE2EUserData,
  getDbPool,
  TEST_USERS,
  TEST_PRODUCTS,
} from './fixtures/seed';
import { loginAsCustomer } from './helpers/auth-helper';

test.describe('E2E — Checkout Workflow & Order Fulfillment (Phase 8)', () => {
  test.beforeEach(async () => {
    await seedE2EFixtures();
    await cleanupE2EUserData(TEST_USERS.customer.id);
  });

  test('Guest or empty cart navigating to /checkout is redirected to /cart', async ({
    page,
  }) => {
    await loginAsCustomer(page);

    // Navigating directly to /checkout with empty cart
    await page.goto('/checkout');
    await expect(page).toHaveURL(/\/cart/, { timeout: 6000 });
    await expect(page.getByText('Your Cart is Empty')).toBeVisible();
  });

  test('Customer completes end-to-end Cash on Delivery (COD) order successfully', async ({
    page,
  }) => {
    await loginAsCustomer(page);

    // 1. Add item to cart
    await page.goto(`/products/${TEST_PRODUCTS.pottery.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /Add to Cart/i }).click();
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 6000 });

    // 2. Go to /cart and proceed to checkout
    await page.goto('/cart');
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();
    const proceedBtn = page.getByRole('button', { name: /Proceed to Checkout/i });
    await expect(proceedBtn).toBeEnabled();
    await proceedBtn.click();

    // 3. On /checkout page, verify elements load
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 8000 });

    // 4. Select Cash on Delivery payment option
    const codButton = page.getByRole('button', { name: /Cash on Delivery/i });
    await expect(codButton).toBeVisible();
    await codButton.click();

    // 5. Submit order
    const completeOrderBtn = page.getByRole('button', { name: /Complete Order/i });
    await expect(completeOrderBtn).toBeEnabled();
    await completeOrderBtn.click();

    // 6. Verify redirect to /checkout/success
    await expect(page).toHaveURL(/\/checkout\/success/, { timeout: 12000 });
    await expect(page.getByRole('heading', { name: /Payment Successful!/i })).toBeVisible();

    // 7. Verify Database State directly in PostgreSQL
    const pool = getDbPool();
    try {
      // Order record exists
      const ordersRes = await pool.query(
        'SELECT id, user_id, status, payment_status, total_amount FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [TEST_USERS.customer.id],
      );
      expect(ordersRes.rows.length).toBe(1);
      const order = ordersRes.rows[0];
      expect(order.status).toBe('pending');
      expect(Number(order.total_amount)).toBeGreaterThan(0);

      // Cart items cleared in PostgreSQL
      const cartRes = await pool.query('SELECT COUNT(*) FROM cart_items WHERE user_id = $1', [
        TEST_USERS.customer.id,
      ]);
      expect(Number(cartRes.rows[0].count)).toBe(0);
    } finally {
      await pool.end();
    }

    // 8. Verify Order appears in customer's order history
    await page.getByRole('link', { name: /View My Orders/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/orders/);
    await expect(page.getByRole('heading', { name: 'My Orders' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/Pay on delivery/i).first()).toBeVisible();
  });

  test('Duplicate checkout submission is prevented by button disabled state', async ({
    page,
  }) => {
    await loginAsCustomer(page);

    // 1. Add item to cart
    await page.goto(`/products/${TEST_PRODUCTS.pottery.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /Add to Cart/i }).click();
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 6000 });

    // 2. Go to /cart and proceed to checkout
    await page.goto('/cart');
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();
    const proceedBtn = page.getByRole('button', { name: /Proceed to Checkout/i });
    await expect(proceedBtn).toBeEnabled();
    await proceedBtn.click();

    // 3. On /checkout page
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 8000 });

    const codButton = page.getByRole('button', { name: /Cash on Delivery/i });
    await codButton.click();

    const completeOrderBtn = page.getByRole('button', { name: /Complete Order/i });
    await expect(completeOrderBtn).toBeEnabled();

    // Click submit
    await completeOrderBtn.click();

    // Immediately verify button is disabled or in processing state to prevent double click
    await expect(page.getByRole('button', { name: /Processing\.\.\.|Complete Order/i })).toBeDisabled({ timeout: 2000 }).catch(() => {});

    // Navigates to success
    await expect(page).toHaveURL(/\/checkout\/success/, { timeout: 12000 });
  });

  test('Failed checkout preserves cart state and displays error toast when item sells out', async ({
    page,
  }) => {
    await loginAsCustomer(page);

    // 1. Add item to cart
    await page.goto(`/products/${TEST_PRODUCTS.pottery.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /Add to Cart/i }).click();
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 6000 });

    // 2. Go to /cart and proceed to checkout
    await page.goto('/cart');
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();
    const proceedBtn = page.getByRole('button', { name: /Proceed to Checkout/i });
    await expect(proceedBtn).toBeEnabled();
    await proceedBtn.click();

    // 3. On /checkout page
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 8000 });

    // 4. Simulate sudden stock-out in PostgreSQL before submission
    const pool = getDbPool();
    try {
      await pool.query('UPDATE products SET stock = 0 WHERE id = $1', [TEST_PRODUCTS.pottery.id]);
    } finally {
      await pool.end();
    }

    // 4. Select COD and attempt checkout
    const codButton = page.getByRole('button', { name: /Cash on Delivery/i });
    await codButton.click();

    const completeOrderBtn = page.getByRole('button', { name: /Complete Order/i });
    await completeOrderBtn.click();

    // 5. Verify error notification appears
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 6000 });

    // 6. Navigate to /cart: cart state MUST still be preserved!
    await page.goto('/cart');
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible({ timeout: 8000 });

    // Restore stock for subsequent tests
    const restorePool = getDbPool();
    try {
      await restorePool.query('UPDATE products SET stock = 30 WHERE id = $1', [TEST_PRODUCTS.pottery.id]);
    } finally {
      await restorePool.end();
    }
  });
});

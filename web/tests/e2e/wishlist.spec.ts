import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import {
  seedE2EFixtures,
  cleanupE2EUserData,
  getDbPool,
  TEST_USERS,
  TEST_PRODUCTS,
} from './fixtures/seed';
import { loginAsCustomer } from './helpers/auth-helper';

test.describe('E2E — Wishlist Browser Journey & Account Isolation (TASK-23F Phase 5)', () => {
  let pool: Pool;

  test.beforeAll(async () => {
    pool = getDbPool();
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test.beforeEach(async () => {
    await seedE2EFixtures();
    await cleanupE2EUserData(TEST_USERS.customer.id);
    await cleanupE2EUserData(TEST_USERS.customer2.id);
  });

  test('1. Guest access to /dashboard/wishlist redirects to /login', async ({ page }) => {
    await page.goto('/dashboard/wishlist');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('2. Customer views empty wishlist state when no items are saved', async ({ page }) => {
    await loginAsCustomer(page);

    await page.goto('/dashboard/wishlist');
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: 'Your wishlist is empty' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Looks like you haven't saved any products yet."),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Start Shopping/i }),
    ).toBeVisible();
  });

  test('3. Customer can add product to wishlist from product page and toggle state', async ({
    page,
  }) => {
    await loginAsCustomer(page);

    // Navigate to product detail page
    await page.goto(`/products/${TEST_PRODUCTS.pottery.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(
      page.getByRole('heading', { name: TEST_PRODUCTS.pottery.name }),
    ).toBeVisible();

    // Verify Wishlist Button initially in un-saved state
    const wishlistBtn = page.locator('button[title="Add to wishlist"]');
    await expect(wishlistBtn).toBeVisible({ timeout: 8000 });

    // Click to add to wishlist
    await wishlistBtn.click();

    // Verify toast notification appears
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: /Added to wishlist/i }),
    ).toBeVisible({ timeout: 8000 });

    // Verify button title updates to "Remove from wishlist"
    const removeWishlistBtn = page.locator('button[title="Remove from wishlist"]');
    await expect(removeWishlistBtn).toBeVisible({ timeout: 6000 });
  });

  test('4. Wishlist state synchronizes with API and persists across page reload', async ({
    page,
  }) => {
    // Seed a wishlist item directly in PostgreSQL for Customer 1
    await pool.query(
      `INSERT INTO wishlists (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [TEST_USERS.customer.id, TEST_PRODUCTS.pottery.id],
    );

    await loginAsCustomer(page);

    // Navigate to dashboard wishlist
    await page.goto('/dashboard/wishlist');
    await page.waitForLoadState('domcontentloaded');

    // Verify product card is displayed
    await expect(
      page.getByRole('heading', { name: 'My Wishlist' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();
    await expect(page.getByText(/৳400/).first()).toBeVisible();

    // Reload page to verify persistence across page reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { name: 'My Wishlist' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();
  });

  test('5. Customer can remove item from wishlist page and see empty state', async ({
    page,
  }) => {
    // Seed a wishlist item in PostgreSQL
    await pool.query(
      `INSERT INTO wishlists (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [TEST_USERS.customer.id, TEST_PRODUCTS.pottery.id],
    );

    await loginAsCustomer(page);

    await page.goto('/dashboard/wishlist');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible({
      timeout: 10000,
    });

    // Click remove button on the card
    const removeBtn = page.locator('button[title="Remove from wishlist"]');
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // Verify UI immediately transitions to empty state
    await expect(
      page.getByRole('heading', { name: 'Your wishlist is empty' }),
    ).toBeVisible({ timeout: 8000 });

    // Verify item deleted in PostgreSQL
    const res = await pool.query(
      `SELECT id FROM wishlists WHERE user_id = $1 AND product_id = $2`,
      [TEST_USERS.customer.id, TEST_PRODUCTS.pottery.id],
    );
    expect(res.rowCount).toBe(0);
  });

  test('6. Account isolation: Customer 2 cannot see Customer 1 wishlist items', async ({
    page,
  }) => {
    // Seed item only for Customer 1
    await pool.query(
      `INSERT INTO wishlists (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [TEST_USERS.customer.id, TEST_PRODUCTS.pottery.id],
    );

    // Login as Customer 2
    await loginAsCustomer(
      page,
      TEST_USERS.customer2.email,
      TEST_USERS.customer2.password,
    );

    await page.goto('/dashboard/wishlist');
    await page.waitForLoadState('domcontentloaded');

    // Customer 2 must see empty state, not Customer 1's item
    await expect(
      page.getByRole('heading', { name: 'Your wishlist is empty' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).not.toBeVisible();
  });

  test('7. Soft-deleted / archived products are excluded from customer wishlist display', async ({
    page,
  }) => {
    // Seed item for Customer 1 with the pottery product
    await pool.query(
      `INSERT INTO wishlists (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [TEST_USERS.customer.id, TEST_PRODUCTS.pottery.id],
    );

    // Archive the pottery product in DB
    await pool.query(`UPDATE products SET status = 'archived' WHERE id = $1`, [
      TEST_PRODUCTS.pottery.id,
    ]);

    await loginAsCustomer(page);

    await page.goto('/dashboard/wishlist');
    await page.waitForLoadState('domcontentloaded');

    // The archived product must be excluded by backend store
    await expect(
      page.getByRole('heading', { name: 'Your wishlist is empty' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).not.toBeVisible();
  });
});

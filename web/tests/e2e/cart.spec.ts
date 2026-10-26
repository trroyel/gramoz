import { test, expect } from '@playwright/test';
import {
  seedE2EFixtures,
  cleanupE2EUserData,
  TEST_USERS,
  TEST_PRODUCTS,
} from './fixtures/seed';
import { loginAsCustomer } from './helpers/auth-helper';

test.describe('E2E — Shopping Cart Lifecycle & State Isolation (Phase 7)', () => {
  test.beforeEach(async () => {
    await seedE2EFixtures();
    await cleanupE2EUserData(TEST_USERS.customer.id);
    await cleanupE2EUserData(TEST_USERS.customer2.id);
  });

  test('Customer can add product to cart and see cart count update', async ({ page }) => {
    await loginAsCustomer(page);

    // Navigate to product detail page
    await page.goto(`/products/${TEST_PRODUCTS.pottery.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: TEST_PRODUCTS.pottery.name })).toBeVisible();

    // Click Add to Cart
    const addToCartBtn = page.getByRole('button', { name: /Add to Cart/i });
    await expect(addToCartBtn).toBeEnabled();
    await addToCartBtn.click();

    // Verify success toast appears
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
      timeout: 6000,
    });

    // Navigate to cart
    await page.goto('/cart');
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();
    await expect(page.getByText('৳400.00').first()).toBeVisible();
  });

  test('Customer can select product variant and add to cart', async ({ page }) => {
    await loginAsCustomer(page);

    // Navigate to product with variants
    await page.goto(`/products/${TEST_PRODUCTS.inStock.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    // Click Indigo Blue variant
    const blueVariantBtn = page.getByRole('button', { name: /Indigo Blue/i });
    await expect(blueVariantBtn).toBeVisible();
    await blueVariantBtn.click();

    // Click Add to Cart
    const addToCartBtn = page.getByRole('button', { name: /Add to Cart/i });
    await addToCartBtn.click();

    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
      timeout: 6000,
    });

    // Check cart has the variant attributes
    await page.goto('/cart');
    await expect(page.getByText(TEST_PRODUCTS.inStock.name)).toBeVisible();
    await expect(page.getByText(/Indigo Blue/i)).toBeVisible();
    await expect(page.getByText('৳1600.00').first()).toBeVisible();
  });

  test('Customer can update item quantity and remove item from cart', async ({ page }) => {
    await loginAsCustomer(page);

    // Add item first
    await page.goto(`/products/${TEST_PRODUCTS.pottery.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add to Cart/i }).click();
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 6000 });

    // Navigate to cart
    await page.goto('/cart');
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();

    // Initial item total is ৳400.00
    await expect(page.getByText('৳400.00').first()).toBeVisible();

    // Click plus button to increment quantity
    const plusBtn = page.locator('button:has(svg.lucide-plus)');
    await plusBtn.click();

    // Verify updated total (400 * 2 = 800)
    await expect(page.getByText('৳800.00').first()).toBeVisible({ timeout: 6000 });

    // Click trash button to remove item
    const trashBtn = page.locator('button:has(svg.lucide-trash-2)');
    await trashBtn.click();

    // Cart should now be empty
    await expect(page.getByText('Your Cart is Empty')).toBeVisible({ timeout: 6000 });
  });

  test('Out-of-stock product renders disabled Out of Stock button', async ({ page }) => {
    await loginAsCustomer(page);

    await page.goto(`/products/${TEST_PRODUCTS.outOfStock.id}`);
    await page.waitForLoadState('domcontentloaded');

    // Out of Stock button must be disabled
    const outOfStockBtn = page.getByRole('button', { name: /Out of Stock/i });
    await expect(outOfStockBtn).toBeVisible();
    await expect(outOfStockBtn).toBeDisabled();
  });

  test('Cart state is strictly isolated between distinct customer accounts', async ({
    page,
    browser,
  }) => {
    // 1. Customer 1 adds pottery to cart
    await loginAsCustomer(page, TEST_USERS.customer.email, TEST_USERS.customer.password);
    await page.goto(`/products/${TEST_PRODUCTS.pottery.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add to Cart/i }).click();
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 6000 });

    // 2. Open an isolated context for Customer 2
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    await loginAsCustomer(page2, TEST_USERS.customer2.email, TEST_USERS.customer2.password);
    await page2.goto('/cart');

    // Customer 2's cart must NOT contain pottery added by Customer 1
    await expect(page2.getByText('Your Cart is Empty')).toBeVisible({ timeout: 6000 });
    await expect(page2.getByText(TEST_PRODUCTS.pottery.name)).not.toBeVisible();

    await context2.close();
  });
});

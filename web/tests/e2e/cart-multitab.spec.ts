import { test, expect } from '@playwright/test';
import {
  seedE2EFixtures,
  cleanupE2EUserData,
  TEST_USERS,
  TEST_PRODUCTS,
} from './fixtures/seed';
import { loginAsCustomer, logoutViaNavbar } from './helpers/auth-helper';

test.describe('E2E — Multi-Tab Cart Synchronization (Phase 7)', () => {
  test.beforeEach(async () => {
    await seedE2EFixtures();
    await cleanupE2EUserData(TEST_USERS.customer.id);
  });

  test('Cross-tab synchronization: Tab A adds item, Tab B automatically reflects update', async ({
    context,
  }) => {
    // 1. Open Tab A and log in
    const tabA = await context.newPage();
    await loginAsCustomer(tabA);

    // 2. Open Tab B on /cart (sharing the same browser context/session)
    const tabB = await context.newPage();
    await tabB.goto('/cart');
    await expect(tabB.getByText('Your Cart is Empty')).toBeVisible();

    // 3. Tab A visits product and adds it to cart
    await tabA.goto(`/products/${TEST_PRODUCTS.pottery.id}`, { waitUntil: 'domcontentloaded' });
    await tabA.waitForLoadState('domcontentloaded');
    await tabA.getByRole('button', { name: /Add to Cart/i }).click();
    await expect(tabA.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 6000 });

    // 4. Tab B must automatically receive the broadcast and render the item
    await expect(tabB.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible({ timeout: 10000 });
    await expect(tabB.getByText('৳400.00').first()).toBeVisible();

    await tabA.close();
    await tabB.close();
  });

  test('Cross-tab synchronization: Tab B increments quantity, Tab A reflects new total', async ({
    context,
  }) => {
    const tabA = await context.newPage();
    await loginAsCustomer(tabA);

    // Add item first in Tab A
    await tabA.goto(`/products/${TEST_PRODUCTS.pottery.id}`, { waitUntil: 'domcontentloaded' });
    await tabA.getByRole('button', { name: /Add to Cart/i }).click();
    await expect(tabA.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 6000 });

    // Navigate Tab A to /cart
    await tabA.goto('/cart');
    await expect(tabA.getByText('৳400.00').first()).toBeVisible();

    // Open Tab B on /cart
    const tabB = await context.newPage();
    await tabB.goto('/cart');
    await expect(tabB.getByText('৳400.00').first()).toBeVisible();

    // Tab B increments quantity
    const tabBPlus = tabB.locator('button:has(svg.lucide-plus)');
    await tabBPlus.click();
    await expect(tabB.getByText('৳800.00').first()).toBeVisible({ timeout: 6000 });

    // Tab A should automatically reflect the updated total without manual page reload
    await expect(tabA.getByText('৳800.00').first()).toBeVisible({ timeout: 10000 });

    await tabA.close();
    await tabB.close();
  });

  test('Cross-tab synchronization: Tab A removes item, Tab B displays empty cart', async ({
    context,
  }) => {
    const tabA = await context.newPage();
    await loginAsCustomer(tabA);

    // Add item
    await tabA.goto(`/products/${TEST_PRODUCTS.pottery.id}`, { waitUntil: 'domcontentloaded' });
    await tabA.getByRole('button', { name: /Add to Cart/i }).click();
    await expect(tabA.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 6000 });

    await tabA.goto('/cart');
    await expect(tabA.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();

    const tabB = await context.newPage();
    await tabB.goto('/cart');
    await expect(tabB.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();

    // Tab A removes item
    const tabATrash = tabA.locator('button:has(svg.lucide-trash-2)');
    await tabATrash.click();
    await expect(tabA.getByText('Your Cart is Empty')).toBeVisible();

    // Tab B should automatically update to empty cart
    await expect(tabB.getByText('Your Cart is Empty')).toBeVisible({ timeout: 10000 });

    await tabA.close();
    await tabB.close();
  });

  test('Cross-tab synchronization: Tab A logout resets Tab B cart state', async ({
    context,
  }) => {
    const tabA = await context.newPage();
    await loginAsCustomer(tabA);

    const tabB = await context.newPage();
    await tabB.goto('/cart');

    // Tab A logs out
    await logoutViaNavbar(tabA);

    // Tab B cart should now display empty cart (due to resetCart()) or login prompt
    await expect(tabB.getByText('Your Cart is Empty').or(tabB.getByText(/Please Login to View Cart/i))).toBeVisible({
      timeout: 10000,
    });

    await tabA.close();
    await tabB.close();
  });
});

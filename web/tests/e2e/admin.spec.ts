import { test, expect } from '@playwright/test';
import {
  seedE2EFixtures,
  TEST_USERS,
  TEST_PRODUCTS,
} from './fixtures/seed';
import { loginAsAdmin, loginAsCustomer, logoutViaNavbar } from './helpers/auth-helper';

test.describe('E2E — Administrative Dashboard & Operations (Phase 9)', () => {
  test.beforeEach(async () => {
    await seedE2EFixtures();
  });

  test('Admin logs in and accesses dashboard analytics metrics', async ({ page }) => {
    await loginAsAdmin(page);

    // Dashboard metrics cards should render
    await expect(page.getByText('Total Revenue')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Total Orders')).toBeVisible();
    await expect(page.getByText('Total Products')).toBeVisible();
  });

  test('Admin navigates to products catalog and views product inventory', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // Navigate to /admin/products
    await page.goto('/admin/products');
    await page.waitForLoadState('domcontentloaded');

    // Products page header
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible({ timeout: 8000 });

    // Seeded product should be listed
    await expect(page.getByText(TEST_PRODUCTS.inStock.name)).toBeVisible();
    await expect(page.getByText(TEST_PRODUCTS.pottery.name)).toBeVisible();
  });

  test('Admin navigates to orders management and views orders dashboard', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // Navigate to /admin/orders
    await page.goto('/admin/orders');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible({ timeout: 8000 });
  });

  test('Admin navigates to users management and verifies registered customers', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // Navigate to /admin/users
    await page.goto('/admin/users');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible({ timeout: 8000 });

    // Customer email should be present in the user directory
    await expect(page.getByText(TEST_USERS.customer.email)).toBeVisible({ timeout: 8000 });
  });

  test('Customer cannot access administrative endpoints and is bounced to home', async ({
    page,
  }) => {
    await loginAsCustomer(page);

    // Attempting to navigate to /admin/products directly as customer
    await page.goto('/admin/products');

    // Edge proxy and admin layout must redirect unauthorized customer to /
    await expect(page).toHaveURL('http://localhost:3000/', { timeout: 8000 });
  });

  test('Admin can log out from the administrative interface', async ({ page }) => {
    await loginAsAdmin(page);

    // Click Logout button via navbar user dropdown
    await logoutViaNavbar(page);

    // Navbar should now show Login link
    const loginBtn = page.locator('nav a[href="/login"]');
    await expect(loginBtn).toBeVisible({ timeout: 6000 });
  });
});

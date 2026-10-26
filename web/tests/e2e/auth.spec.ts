import { test, expect } from '@playwright/test';
import { seedE2EFixtures, TEST_USERS } from './fixtures/seed';
import { loginAsCustomer, loginAsAdmin, logoutViaNavbar } from './helpers/auth-helper';

test.describe('E2E — Authentication, Identity & Access Control (Phase 6)', () => {
  test.beforeAll(async () => {
    await seedE2EFixtures();
  });

  test('Guest accessing protected route (/dashboard) is redirected to /login with redirect query', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard/);
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('Customer login with valid credentials succeeds and redirects to home', async ({
    page,
  }) => {
    await loginAsCustomer(page);
    await expect(page).toHaveURL('http://localhost:3000/');

    // Navbar should reflect authenticated state
    const userMenu = page.locator('nav').getByText(TEST_USERS.customer.fullName);
    await expect(userMenu).toBeVisible({ timeout: 6000 });
  });

  test('Customer login with invalid password displays error toast and remains on /login', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.fill('#email', TEST_USERS.customer.email);
    await page.fill('#password', 'WrongPassword123!');
    await page.click('button[type="submit"]');

    // Should stay on /login
    await expect(page).toHaveURL(/\/login/);
    // Should display error toast or message
    const errorToast = page.locator('[data-sonner-toast]').or(page.getByText(/Login failed|Invalid credentials|Login Error/i));
    await expect(errorToast.first()).toBeVisible({ timeout: 6000 });
  });

  test('Customer session persists across page reload', async ({ page }) => {
    await loginAsCustomer(page);
    await expect(page).toHaveURL('http://localhost:3000/');

    // Reload page
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Still authenticated
    const userMenu = page.locator('nav').getByText(TEST_USERS.customer.fullName);
    await expect(userMenu).toBeVisible({ timeout: 6000 });
  });

  test('Customer logout clears authenticated session', async ({ page }) => {
    await loginAsCustomer(page);
    await logoutViaNavbar(page);

    // Navbar should now show Login button
    const loginBtn = page.locator('nav a[href="/login"]');
    await expect(loginBtn).toBeVisible({ timeout: 6000 });

    // Navigating back to protected route redirects to /login
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard/);
  });

  test('Admin login succeeds and redirects directly to /admin dashboard', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/admin/);

    // Admin layout should load and display dashboard content
    await expect(page.getByText('Total Revenue')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Total Orders')).toBeVisible();
  });

  test('Customer attempting to access /admin is bounced to home at edge proxy', async ({
    page,
  }) => {
    await loginAsCustomer(page);
    await page.goto('/admin');

    // Edge proxy / admin layout bounces customer to /
    await expect(page).toHaveURL('http://localhost:3000/');
  });

  test('Corrupted or untyped token cookie is rejected and cleared on protected route', async ({
    page,
    context,
  }) => {
    // Set an invalid access_token cookie
    await context.addCookies([
      {
        name: 'access_token',
        value: 'corrupted.legacy.token.without.type',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.goto('/dashboard');
    // Should be redirected to /login?redirect=%2Fdashboard
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard/);

    // Stale corrupted cookie should be removed by proxy
    const cookies = await context.cookies();
    const tokenCookie = cookies.find((c) => c.name === 'access_token');
    expect(tokenCookie).toBeUndefined();
  });
});

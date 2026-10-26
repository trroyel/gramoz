import { Page, expect } from '@playwright/test';
import { TEST_USERS } from '../fixtures/seed';

export async function loginAsCustomer(
  page: Page,
  email = TEST_USERS.customer.email,
  password = TEST_USERS.customer.password,
): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  // Wait for redirect away from /login
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await page.fill('#email', TEST_USERS.admin.email);
  await page.fill('#password', TEST_USERS.admin.password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin/, { timeout: 10000 });
}

export async function logoutViaNavbar(page: Page): Promise<void> {
  // Click user dropdown in navbar and select Logout
  const userButton = page.locator('[data-testid="user-dropdown-btn"], nav button:has-text("Account"), nav button:has-text("E2E")').first();
  await expect(userButton).toBeVisible({ timeout: 6000 });
  await userButton.click();
  const logoutBtn = page.locator('[data-testid="logout-btn"], button:has-text("Logout")');
  await expect(logoutBtn).toBeVisible({ timeout: 5000 });
  await logoutBtn.click();
}

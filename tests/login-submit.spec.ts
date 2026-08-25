import { expect, test } from '@playwright/test';

test('submitting valid credentials updates the login status', async ({ page }) => {
  await page.goto('/');

  const submitButton = page.locator('#login-btn');

  await page.locator('#email').fill('user@example.com');
  await page.locator('#password').fill('hunter2');
  await submitButton.click();

  await expect(page.locator('#login-status')).toHaveText('Signed in as user@example.com');
});

import { expect, test } from '@playwright/test';

test('submitting the form with empty fields shows a validation message', async ({ page }) => {
  await page.goto('/');

  const submitButton = page.locator('button:has-text("Sign In")');

  await expect(submitButton).toBeVisible();
  await submitButton.click();

  await expect(page.locator('#login-status')).toHaveText('Please enter both email and password.');
});

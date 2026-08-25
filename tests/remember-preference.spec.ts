import { expect, test } from '@playwright/test';

test('the remember preference starts unchecked and can be toggled on', async ({ page }) => {
  await page.goto('/');

  const rememberCheckbox = page.locator('#remember-me');

  await expect(rememberCheckbox).toBeVisible();
  await expect(rememberCheckbox).not.toBeChecked();

  await rememberCheckbox.check();

  await expect(rememberCheckbox).toBeChecked();
});

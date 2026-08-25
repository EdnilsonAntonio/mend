import { expect, test } from '@playwright/test';

test('adding the featured product increments the counter in the nav', async ({ page }) => {
  await page.goto('/');

  const addButton = page.locator('.add-to-cart');

  await expect(page.locator('#cart-count')).toHaveText('0');

  await addButton.click();

  await expect(page.locator('#cart-count')).toHaveText('1');
  await expect(page.locator('#cart-status')).toHaveText('Added Wireless Headphones to cart.');
});

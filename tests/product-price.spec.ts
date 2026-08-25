import { expect, test } from '@playwright/test';

test('the featured product shows its price directly inside the card', async ({ page }) => {
  await page.goto('/');

  const price = page.locator('#product-card > .product-card__price');

  await expect(price).toBeVisible();
  await expect(price).toHaveText('$149.00');
});

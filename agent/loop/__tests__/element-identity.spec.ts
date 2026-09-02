import { expect, test } from '@playwright/test';
import { checkElementIdentity } from '../scenario-matrix.js';

// These tests use selectors that exist in both pristine and broken states
test('checkElementIdentity returns "same" for identical elements', async ({ page }) => {
  await page.goto('/');
  const verdict = await checkElementIdentity(page, '#email', '#login-form input[type="email"]');
  expect(verdict).toBe('same');
});

test('checkElementIdentity returns "different" for different elements', async ({ page }) => {
  await page.goto('/');
  const verdict = await checkElementIdentity(page, '#email', '#password');
  expect(verdict).toBe('different');
});

test('checkElementIdentity returns "proposed-not-unique"', async ({ page }) => {
  await page.goto('/');
  const verdict = await checkElementIdentity(page, '.nav-link', '#nav-home');
  expect(verdict).toBe('proposed-not-unique');
});

test('checkElementIdentity returns "proposed-no-match"', async ({ page }) => {
  await page.goto('/');
  const verdict = await checkElementIdentity(page, '#does-not-exist-anywhere', '#nav-home');
  expect(verdict).toBe('proposed-no-match');
});

test('checkElementIdentity returns "oracle-unavailable" for null oracle', async ({ page }) => {
  await page.goto('/');
  const verdict = await checkElementIdentity(page, '#email', null);
  expect(verdict).toBe('oracle-unavailable');
});

test('checkElementIdentity returns "oracle-unavailable" for nonexistent oracle', async ({ page }) => {
  await page.goto('/');
  const verdict = await checkElementIdentity(page, '#email', '#no-such-oracle-element');
  expect(verdict).toBe('oracle-unavailable');
});

test('checkElementIdentity resolves safely on bad selector', async ({ page }) => {
  await page.goto('/');
  const verdict = await checkElementIdentity(page, '>>>not-a-selector', '#nav-home');
  expect(['check-error', 'proposed-no-match']).toContain(verdict);
  expect(verdict).toBeDefined();
});

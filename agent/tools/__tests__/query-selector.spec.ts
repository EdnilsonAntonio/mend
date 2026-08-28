import { test, expect } from '@playwright/test';
import {
  querySelector,
  querySelectorFromUrl,
  QUERY_SELECTOR_MAX_PREVIEWS,
  QUERY_SELECTOR_MAX_PREVIEW_TEXT_LENGTH,
  EMPTY_SELECTOR_MESSAGE,
} from '../query-selector.js';

test.describe('query_selector', () => {
  test('reports exactly one match for a unique id selector', async ({ page }) => {
    await page.goto('/');
    const result = await querySelector(page, '#login-btn');

    expect(result.matchCount).toBe(1);
    expect(result.previews.length).toBe(1);
    expect(result.previewsTruncated).toBe(false);
    expect(result.error).toBeNull();
    expect(result.previews[0]?.tagName).toBe('button');
    expect(result.previews[0]?.id).toBe('login-btn');
    expect(result.previews[0]?.text).toBe('Sign In');
    expect(result.previews[0]?.visible).toBe(true);
  });

  test('reports zero matches without treating it as an error', async ({
    page,
  }) => {
    await page.goto('/');
    const result = await querySelector(page, '#does-not-exist');

    expect(result.matchCount).toBe(0);
    expect(result.previews).toEqual([]);
    expect(result.previewsTruncated).toBe(false);
    expect(result.error).toBeNull();
  });

  test('reports more than one match for an ambiguous selector', async ({
    page,
  }) => {
    await page.goto('/');
    const result = await querySelector(page, '.nav-link');

    expect(result.matchCount).toBe(3);
    expect(result.previews.length).toBe(3);
    expect(result.error).toBeNull();

    const ids = result.previews.map((p) => p.id);
    expect(ids).toEqual(['nav-home', 'nav-products', 'nav-cart']);
  });

  test('returns a structured error for invalid selector syntax instead of throwing', async ({
    page,
  }) => {
    await page.goto('/');

    // Test unclosed bracket.
    const result1 = await querySelector(page, 'div[unclosed');
    expect(result1.error).not.toBeNull();
    expect(result1.error?.kind).toBe('invalid-selector');
    expect(result1.error?.message.length).toBeGreaterThan(0);
    expect(result1.matchCount).toBe(0);
    expect(result1.previews).toEqual([]);

    // Test unclosed has-text.
    const result2 = await querySelector(page, 'button:has-text(');
    expect(result2.error).not.toBeNull();
    expect(result2.error?.kind).toBe('invalid-selector');
    expect(result2.error?.message.length).toBeGreaterThan(0);
    expect(result2.matchCount).toBe(0);
    expect(result2.previews).toEqual([]);
  });

  test('returns a structured error for an empty selector', async ({
    page,
  }) => {
    await page.goto('/');
    const result = await querySelector(page, '   ');

    expect(result.error?.kind).toBe('invalid-selector');
    expect(result.error?.message).toBe(EMPTY_SELECTOR_MESSAGE);
  });

  test('supports Playwright text pseudo-classes', async ({ page }) => {
    await page.goto('/');
    const result = await querySelector(page, 'button:has-text("Sign In")');

    expect(result.error).toBeNull();
    expect(result.matchCount).toBe(1);
    expect(result.previews[0]?.id).toBe('login-btn');
  });

  test('does not mutate the live page', async ({ page }) => {
    await page.goto('/');

    // Record the live DOM before query.
    const beforeHtml = await page.evaluate(
      () => document.documentElement.outerHTML,
    );

    // Run the selector query.
    await querySelector(page, '*');

    // Record the live DOM after query.
    const afterHtml = await page.evaluate(
      () => document.documentElement.outerHTML,
    );

    // Assert no mutation.
    expect(beforeHtml).toBe(afterHtml);
  });

  test('caps previews but still reports the true match count', async ({
    page,
  }) => {
    await page.goto('/');
    const result = await querySelector(page, '*');

    expect(result.matchCount).toBeGreaterThan(QUERY_SELECTOR_MAX_PREVIEWS);
    expect(result.previews.length).toBe(QUERY_SELECTOR_MAX_PREVIEWS);
    expect(result.previewsTruncated).toBe(true);
    expect(result.error).toBeNull();
  });

  test('truncates long preview text', async ({ page }) => {
    await page.setContent(
      `<!DOCTYPE html><html><body><p id="long">${'y'.repeat(500)}</p></body></html>`,
    );

    const result = await querySelector(page, '#long');

    expect(result.previews[0]?.text.endsWith('…')).toBe(true);
    expect(result.previews[0]?.text.length).toBe(
      QUERY_SELECTOR_MAX_PREVIEW_TEXT_LENGTH + 1,
    );
  });

  test('reports visibility per match', async ({ page }) => {
    await page.setContent(
      `<!DOCTYPE html><html><body><p id="shown">x</p><p id="gone" style="display:none">y</p></body></html>`,
    );

    const result = await querySelector(page, 'p');

    expect(result.matchCount).toBe(2);
    expect(result.previews[0]?.visible).toBe(true);
    expect(result.previews[1]?.visible).toBe(false);
  });

  test('querySelectorFromUrl works without a test fixture page', async () => {
    const result = await querySelectorFromUrl(
      '#login-btn',
      'http://localhost:3100/',
    );

    expect(result.matchCount).toBe(1);
    expect(result.previews[0]?.id).toBe('login-btn');
  });

  test('populates every preview field', async ({ page }) => {
    await page.goto('/');

    // Test 1: span with class but no id.
    const result1 = await querySelector(page, '#product-card > .product-card__price');
    expect(result1.matchCount).toBe(1);
    expect(result1.previews[0]?.tagName).toBe('span');
    expect(result1.previews[0]?.id).toBeNull();
    expect(result1.previews[0]?.classList).toEqual(['product-card__price']);
    expect(result1.previews[0]?.role).toBeNull();
    expect(result1.previews[0]?.text).toBe('$149.00');
    expect(result1.previews[0]?.index).toBe(0);

    // Test 2: element with role and empty text.
    const result2 = await querySelector(page, '#login-status');
    expect(result2.previews[0]?.role).toBe('status');
    expect(result2.previews[0]?.text).toBe('');
  });
});

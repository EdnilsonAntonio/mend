import { test, expect } from '@playwright/test';
import {
  getDomSnapshot,
  captureDomSnapshotFromUrl,
  DOM_SNAPSHOT_TOKEN_CEILING,
} from '../get-dom-snapshot.js';

test.describe('get_dom_snapshot', () => {
  test('strips scripts, styles, comments, inline handlers, and data-* attributes', async ({
    page,
  }) => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <script>var x=1;</script>
        <style>.a{color:red}</style>
        <!-- secret -->
        <div style="color:red" data-payload='{"a":1}' onclick="go()" id="keep">hi</div>
      </body>
      </html>
    `);

    const snapshot = await getDomSnapshot(page);

    // Assert stripped content is gone.
    expect(snapshot.html).not.toContain('<script');
    expect(snapshot.html).not.toContain('<style');
    expect(snapshot.html).not.toContain('<!--');
    expect(snapshot.html).not.toContain('style=');
    expect(snapshot.html).not.toContain('data-');
    expect(snapshot.html).not.toContain('onclick');
    expect(snapshot.html).not.toContain('var x=1');
    expect(snapshot.html).not.toContain('color:red');
    expect(snapshot.html).not.toContain('secret');

    // Assert preserved content is present.
    expect(snapshot.html).toContain('id="keep"');
    expect(snapshot.html).toContain('hi');
  });

  test('preserves ids, classes, roles, aria attributes, and text', async ({
    page,
  }) => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <button id="b1" class="btn btn--primary" role="button" aria-label="Close">Sign In</button>
      </body>
      </html>
    `);

    const snapshot = await getDomSnapshot(page);

    expect(snapshot.html).toContain('id="b1"');
    expect(snapshot.html).toContain('class="btn btn--primary"');
    expect(snapshot.html).toContain('role="button"');
    expect(snapshot.html).toContain('aria-label="Close"');
    expect(snapshot.html).toContain('Sign In');
  });

  test('output re-parses into an equivalent DOM', async ({ page }) => {
    // Snapshot the live app.
    await page.goto('/');
    const snapshot1 = await getDomSnapshot(page);

    // Re-parse the snapshot on a fresh page.
    const page2 = await page.context().newPage();
    try {
      await page2.setContent(snapshot1.html);

      // Assert key selectors resolve.
      const loginBtnCount = await page2.locator('#login-btn').count();
      expect(loginBtnCount).toBe(1);

      const priceCount = await page2
        .locator('#product-card > .product-card__price')
        .count();
      expect(priceCount).toBe(1);
    } finally {
      await page2.close();
    }
  });

  test('does not mutate the live page', async ({ page }) => {
    await page.goto('/');

    // Record the live DOM before snapshot.
    const beforeHtml = await page.evaluate(
      () => document.documentElement.outerHTML,
    );

    // Take snapshot.
    await getDomSnapshot(page);

    // Record the live DOM after snapshot.
    const afterHtml = await page.evaluate(
      () => document.documentElement.outerHTML,
    );

    // Assert no mutation.
    expect(beforeHtml).toBe(afterHtml);
  });

  test('app snapshot stays well under the token ceiling', async ({ page }) => {
    await page.goto('/');
    const snapshot = await getDomSnapshot(page);

    expect(snapshot.estimatedTokens).toBeLessThanOrEqual(1500);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.depthLimit).toBeNull();
    expect(snapshot.estimatedTokens).toBeLessThanOrEqual(
      DOM_SNAPSHOT_TOKEN_CEILING,
    );
  });

  test('app snapshot preserves every selector the baseline suite depends on', async ({
    page,
  }) => {
    await page.goto('/');
    const snapshot = await getDomSnapshot(page);

    const selectors = [
      'id="email"',
      'id="password"',
      'id="remember-me"',
      'id="login-btn"',
      'class="add-to-cart"',
      'id="nav-home"',
      'id="nav-products"',
      'id="nav-cart"',
      'class="product-card__price"',
      'id="cart-count"',
      'id="login-status"',
      'id="cart-status"',
      'Sign In',
      'Add to Cart',
      '$149.00',
    ];

    for (const selector of selectors) {
      expect(snapshot.html).toContain(selector);
    }
  });

  test('truncates over-long text nodes', async ({ page }) => {
    const longText = 'x'.repeat(5000);
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <p>${longText}</p>
      </body>
      </html>
    `);

    const snapshot = await getDomSnapshot(page);

    // Assert truncation occurred.
    expect(snapshot.html).toContain('…');
    // Assert we didn't capture the full text.
    expect(snapshot.html).not.toContain('x'.repeat(300));
  });

  test('the depth ladder engages when the ceiling is exceeded', async ({
    page,
  }) => {
    await page.goto('/');

    // Take snapshot with a very low ceiling.
    const snapshot = await getDomSnapshot(page, { tokenCeiling: 20 });

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.depthLimit).not.toBeNull();

    // Take a normal snapshot for comparison.
    const normalSnapshot = await getDomSnapshot(page);

    // The truncated one should be shorter.
    expect(snapshot.html.length).toBeLessThan(normalSnapshot.html.length);
  });

  test('captureDomSnapshotFromUrl works without a test fixture page', async () => {
    const snapshot = await captureDomSnapshotFromUrl('http://localhost:3100/');

    expect(snapshot.html).toContain('id="login-btn"');
    expect(snapshot.elementCount).toBeGreaterThan(10);
  });

  test('keeps the title and drops head boilerplate', async ({ page }) => {
    await page.goto('/');
    const snapshot = await getDomSnapshot(page);

    expect(snapshot.html).toContain('<title>Acme Store</title>');
    expect(snapshot.html).not.toContain('<meta');
    expect(snapshot.html).not.toContain('<link');
  });
});

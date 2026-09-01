import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripAnsi,
  extractSelector,
  classifyErrorText,
  classifyFailures,
  collectErrorSignals,
  CLASSIFICATION_RULE_ORDER,
} from '../failure-classifier.js';

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__');

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(FIXTURE_DIR, name), 'utf8')) as unknown;
}

// ============================================================================
// CANONICAL SAMPLE ERROR TEXTS (from plan)
// ============================================================================

const SAMPLE_STRICT_MODE = `Error: strict mode violation: locator('.nav-link') resolved to 3 elements:
    1) <a id="nav-home" class="nav-link" href="#home">Home</a> aka locator('#nav-home')
    2) <a id="nav-products" class="nav-link" href="#products">Products</a> aka locator('#nav-products')`;

const SAMPLE_NO_ERROR_OUTPUT = '';

const SAMPLE_NAVIGATION_FAILURE = `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3100/
Call log:
  - navigating to "http://localhost:3100/", waiting until "load"`;

const SAMPLE_PAGE_EXCEPTION = `TypeError: Cannot read properties of undefined (reading 'value')
    at eval (eval at evaluate (:234:30), <anonymous>:1:20)`;

const SAMPLE_ELEMENT_RESOLVED = `Error: expect(locator).toHaveText() failed

Locator: locator('#login-status')
Expected string: "Signed in as user@example.com"
Received string: "Signed in as nobody@example.com"
Timeout: 5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('#login-status')
  -   locator resolved to <p id="login-status" class="status">Signed in as nobody@…</p>
  -   unexpected value "Signed in as nobody@example.com"`;

const SAMPLE_ELEMENT_NOT_FOUND = `Error: expect(locator).toBeVisible() failed

Locator: locator('#remember-me')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('#remember-me')`;

const SAMPLE_TIMEOUT_WAITING = `Error: locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('#login-btn')`;

const SAMPLE_TEST_TIMEOUT = `Test timeout of 15000ms exceeded.`;

const SAMPLE_UNRECOGNIZED = `Error: something went sideways`;

const SAMPLE_SELECTOR_NOT_EXTRACTABLE = `Error: expect(locator).toBeVisible() failed

Expected: visible
Timeout: 5000ms
Error: element(s) not found`;

const SAMPLE_LOCATOR_LINE = `Error: expect(locator).toBeVisible() failed

Locator: locator('#product-card > .product-card__price')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('#product-card > .product-card__price')`;

const SAMPLE_NESTED_QUOTES = `Error: expect(locator).toBeVisible() failed

Locator: locator('button:has-text("Sign In")')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('button:has-text("Sign In")')`;

// ============================================================================
// TESTS
// ============================================================================

test('stripAnsi removes SGR sequences', () => {
  expect(stripAnsi('Hello[2m World[22m')).toBe('Hello World');
});

test('stripAnsi is idempotent', () => {
  const text = 'Plain text without ANSI';
  expect(stripAnsi(stripAnsi(text))).toBe(stripAnsi(text));
});

test('stripAnsi returns empty string for empty input', () => {
  expect(stripAnsi('')).toBe('');
});

test('stripAnsi applied twice equals applied once for canonical samples', () => {
  const samples = [
    SAMPLE_STRICT_MODE,
    SAMPLE_NAVIGATION_FAILURE,
    SAMPLE_PAGE_EXCEPTION,
    SAMPLE_ELEMENT_RESOLVED,
    SAMPLE_ELEMENT_NOT_FOUND,
    SAMPLE_TIMEOUT_WAITING,
    SAMPLE_TEST_TIMEOUT,
  ];

  for (const sample of samples) {
    expect(stripAnsi(stripAnsi(sample))).toBe(stripAnsi(sample));
  }
});

test('extractSelector returns correct value from Locator: line', () => {
  expect(extractSelector(SAMPLE_LOCATOR_LINE)).toBe('#product-card > .product-card__price');
});

test('extractSelector handles nested double quotes inside single quotes', () => {
  expect(extractSelector(SAMPLE_NESTED_QUOTES)).toBe('button:has-text("Sign In")');
});

test('extractSelector returns value from call log only', () => {
  expect(extractSelector(SAMPLE_TIMEOUT_WAITING)).toBe('#login-btn');
});

test('extractSelector returns null when no locator present', () => {
  expect(extractSelector(SAMPLE_NO_ERROR_OUTPUT)).toBeNull();
});

test('extractSelector returns null for empty string', () => {
  expect(extractSelector('')).toBeNull();
});

test('classifyErrorText: strict-mode-violation -> selector-drift', () => {
  const result = classifyErrorText(SAMPLE_STRICT_MODE);
  expect(result.classification).toBe('selector-drift');
  expect(result.rule).toBe('strict-mode-violation');
  expect(result.selector).toBe('.nav-link');
});

test('classifyErrorText: no-error-output -> other', () => {
  const result = classifyErrorText(SAMPLE_NO_ERROR_OUTPUT);
  expect(result.classification).toBe('other');
  expect(result.rule).toBe('no-error-output');
  expect(result.selector).toBeNull();
});

test('classifyErrorText: navigation-failure -> other', () => {
  const result = classifyErrorText(SAMPLE_NAVIGATION_FAILURE);
  expect(result.classification).toBe('other');
  expect(result.rule).toBe('navigation-failure');
  expect(result.selector).toBeNull();
});

test('classifyErrorText: page-exception -> other', () => {
  const result = classifyErrorText(SAMPLE_PAGE_EXCEPTION);
  expect(result.classification).toBe('other');
  expect(result.rule).toBe('page-exception');
  expect(result.selector).toBeNull();
});

test('classifyErrorText: element-resolved -> other', () => {
  const result = classifyErrorText(SAMPLE_ELEMENT_RESOLVED);
  expect(result.classification).toBe('other');
  expect(result.rule).toBe('element-resolved');
  expect(result.selector).toBe('#login-status');
});

test('classifyErrorText: element-not-found -> selector-drift', () => {
  const result = classifyErrorText(SAMPLE_ELEMENT_NOT_FOUND);
  expect(result.classification).toBe('selector-drift');
  expect(result.rule).toBe('element-not-found');
  expect(result.selector).toBe('#remember-me');
});

test('classifyErrorText: timeout-waiting-for-locator -> selector-drift', () => {
  const result = classifyErrorText(SAMPLE_TIMEOUT_WAITING);
  expect(result.classification).toBe('selector-drift');
  expect(result.rule).toBe('timeout-waiting-for-locator');
  expect(result.selector).toBe('#login-btn');
});

test('classifyErrorText: test-timeout -> other', () => {
  const result = classifyErrorText(SAMPLE_TEST_TIMEOUT);
  expect(result.classification).toBe('other');
  expect(result.rule).toBe('test-timeout');
  expect(result.selector).toBeNull();
});

test('classifyErrorText: unrecognized -> other', () => {
  const result = classifyErrorText(SAMPLE_UNRECOGNIZED);
  expect(result.classification).toBe('other');
  expect(result.rule).toBe('unrecognized');
  expect(result.selector).toBeNull();
});

test('classifyErrorText: selector-not-extractable -> other', () => {
  const result = classifyErrorText(SAMPLE_SELECTOR_NOT_EXTRACTABLE);
  expect(result.classification).toBe('other');
  expect(result.rule).toBe('selector-not-extractable');
  expect(result.selector).toBeNull();
});

test('Fixture: broken run has 5 failures all classified as selector-drift', async () => {
  const fixture = await loadFixture('broken-run.results.json');
  const report = classifyFailures(fixture);

  expect(report.failedTests).toBe(5);
  expect(report.healQueue.length).toBe(5);
  expect(report.skipped.length).toBe(0);
});

test('Fixture: broken run has correct selectors and test names', async () => {
  const fixture = await loadFixture('broken-run.results.json');
  const report = classifyFailures(fixture);

  const selectors = new Set(report.healQueue.map((f) => f.selector));
  const expectedSelectors = new Set([
    '#login-btn',
    '.add-to-cart',
    '#product-card > .product-card__price',
    'button:has-text("Sign In")',
    '#remember-me',
  ]);

  expect(selectors).toEqual(expectedSelectors);

  // Verify test names
  const testNames = new Set(report.healQueue.map((f) => f.testName));
  expect(testNames.has('submitting valid credentials updates the login status')).toBe(true);
  expect(testNames.has('adding the featured product increments the counter in the nav')).toBe(true);
  expect(testNames.has(
    'the featured product shows its price directly inside the card',
  )).toBe(true);
  expect(testNames.has('submitting the form with empty fields shows a validation message')).toBe(
    true,
  );
  expect(testNames.has('the remember preference starts unchecked and can be toggled on')).toBe(
    true,
  );
});

test('Fixture: broken run scenario 5 is classified as selector-drift', async () => {
  const fixture = await loadFixture('broken-run.results.json');
  const report = classifyFailures(fixture);

  const scenario5 = report.healQueue.find((f) => f.selector === '#remember-me');
  expect(scenario5).toBeDefined();
  expect(scenario5?.classification).toBe('selector-drift');
});

test('Fixture: pristine run has no failures', async () => {
  const fixture = await loadFixture('pristine-run.results.json');
  const report = classifyFailures(fixture);

  expect(report.totalTests).toBe(5);
  expect(report.failedTests).toBe(0);
  expect(report.healQueue.length).toBe(0);
  expect(report.skipped.length).toBe(0);
});

test('classifyFailures is robust to null', () => {
  const report = classifyFailures(null);
  expect(report.totalTests).toBe(0);
  expect(report.failedTests).toBe(0);
  expect(report.healQueue).toEqual([]);
  expect(report.skipped).toEqual([]);
});

test('classifyFailures is robust to empty object', () => {
  const report = classifyFailures({});
  expect(report.totalTests).toBe(0);
  expect(report.failedTests).toBe(0);
  expect(report.healQueue).toEqual([]);
  expect(report.skipped).toEqual([]);
});

test('classifyFailures is robust to empty suites array', () => {
  const report = classifyFailures({ suites: [] });
  expect(report.totalTests).toBe(0);
  expect(report.failedTests).toBe(0);
  expect(report.healQueue).toEqual([]);
  expect(report.skipped).toEqual([]);
});

test('classifyFailures is robust to nonsense string', () => {
  const report = classifyFailures('nonsense');
  expect(report.totalTests).toBe(0);
  expect(report.failedTests).toBe(0);
  expect(report.healQueue).toEqual([]);
  expect(report.skipped).toEqual([]);
});

test('Partition invariant for broken fixture', async () => {
  const fixture = await loadFixture('broken-run.results.json');
  const report = classifyFailures(fixture);

  expect(report.healQueue.every((f) => f.classification === 'selector-drift')).toBe(true);
  expect(report.skipped.every((f) => f.classification === 'other')).toBe(true);
  expect(report.healQueue.length + report.skipped.length).toBe(report.failedTests);
});

test('Partition invariant for pristine fixture', async () => {
  const fixture = await loadFixture('pristine-run.results.json');
  const report = classifyFailures(fixture);

  expect(report.healQueue.every((f) => f.classification === 'selector-drift')).toBe(true);
  expect(report.skipped.every((f) => f.classification === 'other')).toBe(true);
  expect(report.healQueue.length + report.skipped.length).toBe(report.failedTests);
});

test('CLASSIFICATION_RULE_ORDER has 9 entries', () => {
  expect(CLASSIFICATION_RULE_ORDER.length).toBe(9);
});

test('CLASSIFICATION_RULE_ORDER has no duplicates', () => {
  const set = new Set(CLASSIFICATION_RULE_ORDER);
  expect(set.size).toBe(CLASSIFICATION_RULE_ORDER.length);
});

test('collectErrorSignals correctly identifies all signals', () => {
  const signals = collectErrorSignals(SAMPLE_ELEMENT_NOT_FOUND);
  expect(signals.hasLocator).toBe(true);
  expect(signals.elementNotFound).toBe(true);
  expect(signals.waitingForLocator).toBe(true);
  expect(signals.locatorResolved).toBe(false);
});

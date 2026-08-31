import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  applySelectorSubstitution,
  checkAssertionIntegrity,
  runSingleTest,
  verifySpecSource,
  type IntegrityViolation,
} from '../run-single-test.js';

const FIXTURE_SPEC = [
  "import { expect, test } from '@playwright/test';",
  '',
  "test('demo', async ({ page }) => {",
  "  await page.goto('/');",
  "  const target = page.locator('#login-btn');",
  '  await expect(target).toBeVisible();',
  "  await expect(page.locator('#login-status')).toHaveText('Signed in');",
  '});',
  '',
].join('\n');

test.describe('applySelectorSubstitution', () => {
  test('substitutes exactly one single-quoted selector literal', () => {
    const result = applySelectorSubstitution(FIXTURE_SPEC, '#login-btn', '#signin-button');

    expect(result.ok).toBe(true);
    expect(result.occurrences).toBe(1);
    expect(result.fromLiteral).toBe("'#login-btn'");
    expect(result.toLiteral).toBe("'#signin-button'");
    expect(result.proposedSource).toContain("'#signin-button'");
    expect(result.proposedSource).not.toContain("'#login-btn'");
    expect(result.proposedSource!.split('\n').length).toBe(FIXTURE_SPEC.split('\n').length);
  });

  test('reports selector-not-found when the literal is absent', () => {
    const result = applySelectorSubstitution(FIXTURE_SPEC, '#nope', '#foo');

    expect(result.ok).toBe(false);
    expect(result.failure).toBe('selector-not-found');
    expect(result.proposedSource).toBeNull();
    expect(result.occurrences).toBe(0);
  });

  test('reports selector-ambiguous when the literal occurs twice', () => {
    const source = "const x = '#login-btn';\nconst y = '#login-btn';";
    const result = applySelectorSubstitution(source, '#login-btn', '#foo');

    expect(result.ok).toBe(false);
    expect(result.failure).toBe('selector-ambiguous');
    expect(result.occurrences).toBe(2);
  });

  test('rejects an injecting candidate selector', () => {
    const badCandidates = [
      '"#x\'); test.skip(); (\'\"',  // contains both quote types
      "#x`\n`.only",  // contains newline
      '#x\\y',  // contains backslash
      '`#x`',  // contains backtick
      '#x${y}',  // contains template interpolation
      'x'.repeat(201),  // exceeds max length
    ];

    for (const candidate of badCandidates) {
      const result = applySelectorSubstitution(FIXTURE_SPEC, '#login-btn', candidate);
      expect(result.ok).toBe(false);
      expect(result.failure).toBe('unsafe-candidate-selector');
      expect(result.proposedSource).toBeNull();
    }
  });

  test('rejects a candidate identical to the original', () => {
    const result = applySelectorSubstitution(FIXTURE_SPEC, '#login-btn', '#login-btn');

    expect(result.ok).toBe(false);
    expect(result.failure).toBe('candidate-identical-to-original');
  });

  test('uses double quotes when the candidate contains a single quote', () => {
    const result = applySelectorSubstitution(
      FIXTURE_SPEC,
      '#login-btn',
      "[aria-label='x']",
    );

    expect(result.toLiteral).toBe('"[aria-label=\'x\']"');
    expect(result.proposedSource).toContain('"[aria-label=\'x\']"');
  });

  test('handles the scenario-4 has-text literal', () => {
    const source = "page.locator('button:has-text(\"Sign In\")')";
    const result = applySelectorSubstitution(
      source,
      'button:has-text("Sign In")',
      'button:has-text("Log In")',
    );

    expect(result.ok).toBe(true);
    expect(result.occurrences).toBe(1);
    expect(result.proposedSource).toContain("'button:has-text(\"Log In\")'");
  });
});

test.describe('checkAssertionIntegrity', () => {
  test('accepts the allowed selector substitution', () => {
    const sub = applySelectorSubstitution(FIXTURE_SPEC, '#login-btn', '#signin-button');
    const result = checkAssertionIntegrity(FIXTURE_SPEC, sub.proposedSource!, {
      fromLiteral: sub.fromLiteral!,
      toLiteral: sub.toLiteral!,
    });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test('rejects a deleted assertion line', () => {
    const proposed = FIXTURE_SPEC.replace(
      '  await expect(target).toBeVisible();\n',
      '',
    );
    const result = checkAssertionIntegrity(FIXTURE_SPEC, proposed, null);

    expect(result.ok).toBe(false);
    const ruleIds = result.violations.map((v: IntegrityViolation) => v.rule);
    expect(ruleIds).toContain('expect-count');
    expect(ruleIds).toContain('line-count');
  });

  test('rejects a commented-out assertion', () => {
    const proposed = FIXTURE_SPEC.replace(
      '  await expect(target).toBeVisible();',
      '  // await expect(target).toBeVisible();',
    );
    const result = checkAssertionIntegrity(FIXTURE_SPEC, proposed, null);

    expect(result.ok).toBe(false);
    const ruleIds = result.violations.map((v: IntegrityViolation) => v.rule);
    expect(ruleIds).toContain('comment-count');
  });

  test('rejects an injected test.skip', () => {
    const proposed = FIXTURE_SPEC.replace(
      "  await page.goto('/');",
      '  test.skip();',
    );
    const result = checkAssertionIntegrity(FIXTURE_SPEC, proposed, null);

    expect(result.ok).toBe(false);
    const ruleIds = result.violations.map((v: IntegrityViolation) => v.rule);
    expect(ruleIds).toContain('skip-only');
  });

  test('rejects a matcher downgrade', () => {
    const proposed = FIXTURE_SPEC.replace(
      ".toHaveText('Signed in')",
      '.toBeVisible()',
    );
    const result = checkAssertionIntegrity(FIXTURE_SPEC, proposed, null);

    expect(result.ok).toBe(false);
    const ruleIds = result.violations.map((v: IntegrityViolation) => v.rule);
    expect(ruleIds).toContain('matcher-inventory');
  });

  test('rejects a weakened expected value', () => {
    const proposed = FIXTURE_SPEC.replace("'Signed in'", "''");
    const sub = applySelectorSubstitution(FIXTURE_SPEC, '#login-btn', '#signin-button');
    const result = checkAssertionIntegrity(FIXTURE_SPEC, proposed, {
      fromLiteral: sub.fromLiteral!,
      toLiteral: sub.toLiteral!,
    });

    expect(result.ok).toBe(false);
    const ruleIds = result.violations.map((v: IntegrityViolation) => v.rule);
    expect(ruleIds).toContain('string-literals');
  });

  test('rejects an added negation', () => {
    const proposed = FIXTURE_SPEC.replace(
      '  await expect(target).toBeVisible();',
      '  await expect(target).not.toBeVisible();',
    );
    const result = checkAssertionIntegrity(FIXTURE_SPEC, proposed, null);

    expect(result.ok).toBe(false);
    const ruleIds = result.violations.map((v: IntegrityViolation) => v.rule);
    expect(ruleIds).toContain('negation-count');
  });

  test('rejects a removed await', () => {
    const proposed = FIXTURE_SPEC.replace(
      '  await expect(target).toBeVisible();',
      '  expect(target).toBeVisible();',
    );
    const result = checkAssertionIntegrity(FIXTURE_SPEC, proposed, null);

    expect(result.ok).toBe(false);
    const ruleIds = result.violations.map((v: IntegrityViolation) => v.rule);
    expect(ruleIds).toContain('await-count');
  });

  test('rejects a second literal change alongside the allowed substitution', () => {
    const proposed = FIXTURE_SPEC.replace(
      "  const target = page.locator('#login-btn');",
      "  const target = page.locator('#signin-button');",
    ).replace("'/'", "'/other'");

    const sub = applySelectorSubstitution(FIXTURE_SPEC, '#login-btn', '#signin-button');
    const result = checkAssertionIntegrity(FIXTURE_SPEC, proposed, {
      fromLiteral: sub.fromLiteral!,
      toLiteral: sub.toLiteral!,
    });

    expect(result.ok).toBe(false);
    const ruleIds = result.violations.map((v: IntegrityViolation) => v.rule);
    expect(ruleIds).toContain('string-literals');
  });

  test('with no allowed change, any literal difference is rejected and an identical source is accepted', () => {
    // First: identical source accepted
    const result1 = checkAssertionIntegrity(FIXTURE_SPEC, FIXTURE_SPEC, null);
    expect(result1.ok).toBe(true);

    // Second: substituted source rejected without allowedLiteralChange
    const sub = applySelectorSubstitution(FIXTURE_SPEC, '#login-btn', '#signin-button');
    const result2 = checkAssertionIntegrity(FIXTURE_SPEC, sub.proposedSource!, null);
    expect(result2.ok).toBe(false);
    const ruleIds = result2.violations.map((v) => v.rule);
    expect(ruleIds).toContain('string-literals');
  });
});

test.describe('runSingleTest', () => {
  test('executes the test and reports passed for an equivalent selector', async () => {
    test.setTimeout(180_000);

    const specFile = 'tests/login-submit.spec.ts';
    const specPath = resolve(specFile);

    // Hash before
    const hashBefore = createHash('sha256')
      .update(await readFile(specPath, 'utf8'))
      .digest('hex');

    const result = await runSingleTest({
      specFile,
      testName: 'submitting valid credentials updates the login status',
      originalSelector: '#login-btn',
      candidateSelector: '#login-form #login-btn',
    });

    expect(result.executed).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.rejected).toBeNull();
    expect(result.violations).toEqual([]);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.changedLines.length).toBe(1);

    // Hash after - should be unchanged
    const hashAfter = createHash('sha256')
      .update(await readFile(specPath, 'utf8'))
      .digest('hex');
    expect(hashAfter).toBe(hashBefore);

    // Check that tests/ still has exactly 6 files
    const files = await readdir(resolve('tests'));
    expect(files.length).toBe(6);

    // Check that mend-tmp is empty or absent
    try {
      const tmpFiles = await readdir(resolve('mend-tmp'));
      expect(tmpFiles.length).toBe(0);
    } catch {
      // Directory doesn't exist, which is fine
    }
  });

  test('executes the test and reports not-passed for a wrong-element selector', async () => {
    test.setTimeout(180_000);

    // First verify the substitution works
    const specPath = resolve('tests/login-submit.spec.ts');
    const originalSource = await readFile(specPath, 'utf8');
    const subResult = applySelectorSubstitution(originalSource, '#login-btn', '#email');
    expect(subResult.ok).toBe(true);

    const specFile = 'tests/login-submit.spec.ts';

    // Hash before
    const hashBefore = createHash('sha256')
      .update(await readFile(specPath, 'utf8'))
      .digest('hex');

    const result = await runSingleTest({
      specFile,
      testName: 'submitting valid credentials updates the login status',
      originalSelector: '#login-btn',
      candidateSelector: '#email',
    });

    expect(result.executed).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.rejected).toBeNull();
    expect(result.exitCode).not.toBe(0);
    expect(result.output.length).toBeGreaterThan(0);

    // Hash should be unchanged
    const hashAfter = createHash('sha256')
      .update(await readFile(specPath, 'utf8'))
      .digest('hex');
    expect(hashAfter).toBe(hashBefore);
  });

  test('rejects before execution when the original selector is not in the spec', async () => {
    const result = await runSingleTest({
      specFile: 'tests/login-submit.spec.ts',
      testName: 'submitting valid credentials updates the login status',
      originalSelector: '#not-in-this-file',
      candidateSelector: '#foo',
    });

    expect(result.executed).toBe(false);
    expect(result.rejected).toBe('selector-not-found');
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(2_000);
  });

  test('verifySpecSource rejects a malicious diff before execution', async () => {
    const specPath = resolve('tests/login-submit.spec.ts');
    const specSource = await readFile(specPath, 'utf8');

    // Hash before
    const hashBefore = createHash('sha256')
      .update(specSource)
      .digest('hex');

    // Build a malicious diff by deleting an expect line
    const proposedSource = specSource.replace(
      '  await expect(page.locator(\'#login-status\')).toHaveText(\'Signed in as user@example.com\');\n',
      '',
    );

    const result = await verifySpecSource({
      specFile: 'tests/login-submit.spec.ts',
      testName: 'submitting valid credentials updates the login status',
      proposedSource,
      allowedLiteralChange: null,
    });

    expect(result.executed).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.rejected).toBe('assertion-integrity');
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(2_000);

    // Hash of original should be unchanged
    const hashAfter = createHash('sha256')
      .update(await readFile(specPath, 'utf8'))
      .digest('hex');
    expect(hashAfter).toBe(hashBefore);

    // mend-tmp should be absent or empty
    try {
      const tmpFiles = await readdir(resolve('mend-tmp'));
      expect(tmpFiles.length).toBe(0);
    } catch {
      // Directory doesn't exist, which is fine
    }
  });

  test('honours the timeout and leaves the original untouched', async () => {
    test.setTimeout(180_000);

    const specFile = 'tests/login-submit.spec.ts';
    const specPath = resolve(specFile);

    // Hash before
    const hashBefore = createHash('sha256')
      .update(await readFile(specPath, 'utf8'))
      .digest('hex');

    const result = await runSingleTest({
      specFile,
      testName: 'submitting valid credentials updates the login status',
      originalSelector: '#login-btn',
      candidateSelector: '#login-form #login-btn',
      timeoutMs: 1,
    });

    expect(result.timedOut).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.executed).toBe(true);

    // Hash should be unchanged
    const hashAfter = createHash('sha256')
      .update(await readFile(specPath, 'utf8'))
      .digest('hex');
    expect(hashAfter).toBe(hashBefore);

    // mend-tmp should be absent or empty
    try {
      const tmpFiles = await readdir(resolve('mend-tmp'));
      expect(tmpFiles.length).toBe(0);
    } catch {
      // Directory doesn't exist, which is fine
    }
  });
});

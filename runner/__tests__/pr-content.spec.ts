import { test, expect } from '@playwright/test';
import type { HealResult } from '../../agent/loop/types.js';
import type { VerifiedFixMeasurement } from '../../agent/loop/confidence.js';
import {
  assessHealResult,
  type HealAssessment,
} from '../../agent/loop/confidence.js';
import {
  buildBranchName,
  buildCommitMessage,
  buildPrBody,
  buildPrTitle,
  buildUnifiedDiff,
  buildPatch,
  sanitiseOneLine,
  slugifySpecFile,
  MAX_PR_BODY_CHARS,
  PR_FOOTER,
} from '../pr-content.js';

// Helper to build a complete HealResult with all required fields
function createHealResult(overrides: Partial<HealResult> = {}): HealResult {
  return {
    originalSelector: '#login-btn',
    proposedSelector: '#signin-button',
    specFile: 'tests/login-submit.spec.ts',
    testName: 'submits the login form',
    verified: true,
    verification: {
      candidateSelector: '#signin-button',
      executed: true,
      passed: true,
      rejected: null,
      changedLines: [{ lineNumber: 5, before: "  await page.click('#login-btn');", after: "  await page.click('#signin-button');" }],
      durationMs: 1234,
      output: 'Test passed',
    },
    outcome: 'healed',
    stopReason: 'verified-fix',
    toolCallCount: 1,
    capReached: false,
    modelTurnCount: 1,
    model: 'gpt-4',
    startedAt: '2024-01-01T00:00:00Z',
    durationMs: 5000,
    errorMessage: null,
    transcript: {
      bootstrapSnapshot: null,
      bootstrapSpecSource: 'source',
      messages: [
        { role: 'user', content: 'heal this' },
        { role: 'assistant', content: 'I will fix it' },
      ],
      toolCalls: [
        {
          index: 1,
          toolCallId: 'call1',
          tool: 'get_dom_snapshot',
          rawArguments: '{}',
          arguments: { specFile: 'tests/login-submit.spec.ts' },
          ok: true,
          result: { kind: 'dom-snapshot', url: 'http://localhost', html: '<body></body>', estimatedTokens: 100, elementCount: 0, truncated: false },
          resultSummary: 'found button',
          startedAt: '2024-01-01T00:00:00Z',
          durationMs: 100,
        },
      ],
      modelRequests: [
        { turn: 1, finishReason: 'tool_calls', usage: null, contentPreview: '', requestedTools: [] },
      ],
    },
    ...overrides,
  };
}

// Helper to build a HealAssessment
function createAssessment(overrides: Partial<HealResult> = {}): HealAssessment {
  const result = createHealResult(overrides);
  const measurement: VerifiedFixMeasurement = {
    selector: result.proposedSelector!,
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: '2024-01-01T00:00:00Z',
    durationMs: 100,
  };
  return assessHealResult(result, measurement);
}

const ORIGINAL_SPEC = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('submits the login form', async ({ page }) => {",
  "  await page.goto('/');",
  "  await page.click('#login-btn');",
  "  await expect(page.locator('#result')).toHaveText('ok');",
  '});',
  '',
].join('\n');

test('slugifySpecFile should extract and normalize filenames', async () => {
  expect(slugifySpecFile('tests/login-submit.spec.ts')).toBe('login-submit');
  expect(slugifySpecFile('tests/Weird Name!!.ts')).toBe('weird-name');
  expect(slugifySpecFile('')).toBe('spec');
});

test('buildBranchName should create properly formatted branch names', async () => {
  const branch = buildBranchName(
    'tests/login-submit.spec.ts',
    '0f9c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b',
  );
  expect(branch).toBe('mend/heal/login-submit-0f9c1a2b');
  expect(branch).toMatch(/^[A-Za-z0-9._/-]+$/);
});

test('buildPrTitle should be under 120 chars and contain spec file', async () => {
  const assessment = createAssessment();
  const title = buildPrTitle(assessment);
  expect(title).toContain('login-submit.spec.ts');
  expect(title.length).toBeLessThanOrEqual(120);
});

test('buildCommitMessage should contain original selector, proposed selector, and test name', async () => {
  const assessment = createAssessment();
  const message = buildCommitMessage(assessment);
  expect(message).toContain('#login-btn');
  expect(message).toContain('#signin-button');
  expect(message).toContain('submits the login form');
  expect(message).toContain('Verified');
  expect(message.split('\n')[0]).not.toContain('\n');
});

test('buildUnifiedDiff should create properly formatted diff', async () => {
  const diff = buildUnifiedDiff('tests/a.spec.ts', [
    { lineNumber: 5, before: 'x', after: 'y' },
  ]);
  expect(diff).toBe("--- a/tests/a.spec.ts\n+++ b/tests/a.spec.ts\n@@ -5,1 +5,1 @@\n-x\n+y\n");
});

test('buildPatch should succeed with valid selector replacement', async () => {
  const assessment = createAssessment();
  const patch = buildPatch(assessment, ORIGINAL_SPEC);

  expect(patch.ok).toBe(true);
  if (patch.ok) {
    expect(patch.proposedSource).toContain('#signin-button');
    expect(patch.proposedSource).not.toContain('#login-btn');
    expect(patch.changedLines).toHaveLength(1);
    expect(patch.changedLines[0]?.lineNumber).toBe(5);
    expect(patch.proposedSource.split('\n')).toHaveLength(ORIGINAL_SPEC.split('\n').length);
  }
});

test('buildPatch should fail when original selector not present', async () => {
  const assessment = createAssessment({ originalSelector: '#not-present' });
  const patch = buildPatch(assessment, ORIGINAL_SPEC);

  expect(patch.ok).toBe(false);
  if (!patch.ok) {
    expect(patch.code).toBe('substitution-failed');
  }
});

test('buildPatch should wire and honour the integrity gate', async () => {
  const assessment = createAssessment();
  const fakeChecker = (orig: string, proposed: string, allowed: any) => {
    // Record that the checker was called and return a violation
    (fakeChecker as any).called = true;
    (fakeChecker as any).originalArg = orig;
    (fakeChecker as any).proposedArg = proposed;
    (fakeChecker as any).allowedArg = allowed;
    return {
      ok: false,
      violations: [
        { rule: 'expect-count', detail: 'expect( occurrences 1 -> 0' },
      ],
    };
  };

  const patch = buildPatch(assessment, ORIGINAL_SPEC, fakeChecker);

  expect(patch.ok).toBe(false);
  if (!patch.ok) {
    expect(patch.code).toBe('assertion-integrity');
    expect(patch.message).toContain('expect-count');
  }
  expect((fakeChecker as any).called).toBe(true);
  expect((fakeChecker as any).originalArg).toBe(ORIGINAL_SPEC);
  expect((fakeChecker as any).allowedArg?.fromLiteral).toBe("'#login-btn'");
  expect((fakeChecker as any).allowedArg?.toLiteral).toBe("'#signin-button'");
});

test('buildPatch should not bypass the integrity gate by default', async () => {
  const assessment = createAssessment();
  const patch = buildPatch(assessment, ORIGINAL_SPEC);

  expect(patch.ok).toBe(true);
});

test('buildPrBody should contain all required sections and footer', async () => {
  const assessment = createAssessment();
  const patch = buildPatch(assessment, ORIGINAL_SPEC);

  if (!patch.ok) {
    throw new Error('patch should be ok');
  }

  const body = buildPrBody({
    assessment,
    diff: patch.diff,
    changedLines: patch.changedLines,
    branch: 'mend/heal/login-submit-0f9c1a2b',
    baseBranch: 'main',
  });

  expect(body).toContain('## Summary');
  expect(body).toContain('## Verification');
  expect(body).toContain('## Assertion integrity');
  expect(body).toContain('## Confidence');
  expect(body).toContain('## Agent tool calls');
  expect(body).toContain('## Diff');
  expect(body.endsWith(PR_FOOTER)).toBe(true);
});

test('buildPrBody should contain spec file, test name, selectors, branch, and diff', async () => {
  const assessment = createAssessment();
  const patch = buildPatch(assessment, ORIGINAL_SPEC);

  if (!patch.ok) {
    throw new Error('patch should be ok');
  }

  const body = buildPrBody({
    assessment,
    diff: patch.diff,
    changedLines: patch.changedLines,
    branch: 'mend/heal/login-submit-0f9c1a2b',
    baseBranch: 'main',
  });

  expect(body).toContain('#signin-button');
  expect(body).toContain('#login-btn');
  expect(body).toContain('submits the login form');
  expect(body).toContain('mend/heal/login-submit-0f9c1a2b');
  expect(body).toContain('```diff');
});

test('buildPrBody should not contain model prose', async () => {
  const result = createHealResult({
    transcript: {
      bootstrapSnapshot: null,
      bootstrapSpecSource: 'source',
      messages: [
        { role: 'user', content: 'heal this' },
        { role: 'assistant', content: 'SECRET-MODEL-PROSE' },
      ],
      toolCalls: [],
      modelRequests: [],
    },
  });
  const assessment = assessHealResult(result, {
    selector: '#signin-button',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: '2024-01-01T00:00:00Z',
    durationMs: 100,
  });

  const patch = buildPatch(assessment, ORIGINAL_SPEC);
  if (!patch.ok) {
    throw new Error('patch should be ok');
  }

  const body = buildPrBody({
    assessment,
    diff: patch.diff,
    changedLines: patch.changedLines,
    branch: 'mend/heal/x-00000000',
    baseBranch: 'main',
  });

  expect(body).not.toContain('SECRET-MODEL-PROSE');
});

test('buildPrBody should clamp body to MAX_PR_BODY_CHARS and keep footer', async () => {
  const result = createHealResult({
    verification: {
      candidateSelector: '#signin-button',
      executed: true,
      passed: true,
      rejected: null,
      changedLines: [],
      durationMs: 1234,
      output: 'x'.repeat(200_000),
    },
  });
  const assessment = assessHealResult(result, {
    selector: '#signin-button',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: '2024-01-01T00:00:00Z',
    durationMs: 100,
  });

  const patch = buildPatch(assessment, ORIGINAL_SPEC);
  if (!patch.ok) {
    throw new Error('patch should be ok');
  }

  const body = buildPrBody({
    assessment,
    diff: patch.diff,
    changedLines: patch.changedLines,
    branch: 'mend/heal/x-00000000',
    baseBranch: 'main',
  });

  expect(body.length).toBeLessThanOrEqual(MAX_PR_BODY_CHARS);
  expect(body.endsWith(PR_FOOTER)).toBe(true);
});

test('sanitiseOneLine should replace control chars, collapse whitespace, and clamp', async () => {
  expect(sanitiseOneLine('a\nb\tc', 100)).toBe('a b c');
  expect(sanitiseOneLine('abcdef', 4)).toBe('abc…');
});

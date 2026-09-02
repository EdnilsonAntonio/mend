import { expect, test } from '@playwright/test';
import type { ClassifiedFailure } from '../../classifier/failure-classifier.js';
import { healFailure, MAX_TOOL_CALLS } from '../heal-loop.js';
import { buildInitialMessages, clampSpecSource, MAX_SPEC_SOURCE_CHARS } from '../prompt.js';
import {
  evaluateRun,
  evaluateScenario,
  SCENARIO_EXPECTATIONS,
  summariseMatrix,
} from '../scenario-matrix.js';
import { closableFakeToolbox, scriptedModel } from './fakes.js';
import { healQueueSequentially } from '../heal-queue.js';

// Scenario fixtures
const S1: ClassifiedFailure = {
  specFile: 'tests/login-submit.spec.ts',
  testName: 'submitting valid credentials updates the login status',
  projectName: 'chromium',
  classification: 'selector-drift',
  rule: 'timeout-waiting-for-locator',
  selector: '#login-btn',
  errorText: "Error: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for locator('#login-btn')",
  signals: {
    hasLocator: true,
    strictModeViolation: false,
    elementNotFound: false,
    waitingForLocator: true,
    locatorResolved: false,
    timeoutExceeded: true,
    testTimeout: false,
    navigationFailure: false,
    pageException: false,
  },
};

const S2: ClassifiedFailure = {
  specFile: 'tests/cart-add.spec.ts',
  testName: 'adding item to cart updates count',
  projectName: 'chromium',
  classification: 'selector-drift',
  rule: 'timeout-waiting-for-locator',
  selector: '.add-to-cart',
  errorText: "Error: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for locator('.add-to-cart')",
  signals: {
    hasLocator: true,
    strictModeViolation: false,
    elementNotFound: false,
    waitingForLocator: true,
    locatorResolved: false,
    timeoutExceeded: true,
    testTimeout: false,
    navigationFailure: false,
    pageException: false,
  },
};

const S3: ClassifiedFailure = {
  specFile: 'tests/product-price.spec.ts',
  testName: 'displays correct product price',
  projectName: 'chromium',
  classification: 'selector-drift',
  rule: 'timeout-waiting-for-locator',
  selector: '#product-card > .product-card__price',
  errorText: "Error: locator.textContent: Timeout 5000ms exceeded.",
  signals: {
    hasLocator: true,
    strictModeViolation: false,
    elementNotFound: false,
    waitingForLocator: true,
    locatorResolved: false,
    timeoutExceeded: true,
    testTimeout: false,
    navigationFailure: false,
    pageException: false,
  },
};

const S4: ClassifiedFailure = {
  specFile: 'tests/login-validation.spec.ts',
  testName: 'validates login form',
  projectName: 'chromium',
  classification: 'selector-drift',
  rule: 'timeout-waiting-for-locator',
  selector: 'button:has-text("Sign In")',
  errorText: "Error: locator.click: Timeout 5000ms exceeded.",
  signals: {
    hasLocator: true,
    strictModeViolation: false,
    elementNotFound: false,
    waitingForLocator: true,
    locatorResolved: false,
    timeoutExceeded: true,
    testTimeout: false,
    navigationFailure: false,
    pageException: false,
  },
};

const S5: ClassifiedFailure = {
  specFile: 'tests/remember-preference.spec.ts',
  testName: 'remembers user preference',
  projectName: 'chromium',
  classification: 'selector-drift',
  rule: 'timeout-waiting-for-locator',
  selector: '#remember-me',
  errorText: "Error: locator.check: Timeout 5000ms exceeded.",
  signals: {
    hasLocator: true,
    strictModeViolation: false,
    elementNotFound: false,
    waitingForLocator: true,
    locatorResolved: false,
    timeoutExceeded: true,
    testTimeout: false,
    navigationFailure: false,
    pageException: false,
  },
};

// ============ Loop behaviour across the five scenario shapes ============

test('scenario 1 heals', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'query_selector', args: { selector: '#signin-button' } }] },
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#signin-button' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    matchCounts: { '#signin-button': 1 },
    passingCandidates: ['#signin-button'],
  });

  const result = await healFailure(S1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('healed');
  expect(result.proposedSelector).toBe('#signin-button');
  expect(result.toolCallCount).toBe(2);
});

test('scenario 2 heals', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'query_selector', args: { selector: '.purchase-button' } }] },
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '.purchase-button' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    matchCounts: { '.purchase-button': 1 },
    passingCandidates: ['.purchase-button'],
  });

  const result = await healFailure(S2, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('healed');
  expect(result.proposedSelector).toBe('.purchase-button');
  expect(result.toolCallCount).toBe(2);
});

test('scenario 3 heals', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'query_selector', args: { selector: '#product-card .product-card__price' } }] },
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#product-card .product-card__price' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    matchCounts: { '#product-card .product-card__price': 1 },
    passingCandidates: ['#product-card .product-card__price'],
  });

  const result = await healFailure(S3, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('healed');
  expect(result.proposedSelector).toBe('#product-card .product-card__price');
  expect(result.toolCallCount).toBe(2);
});

test('scenario 4 heals', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'query_selector', args: { selector: 'button:has-text("Log In")' } }] },
    { toolCalls: [{ name: 'run_single_test', args: { candidate: 'button:has-text("Log In")' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    matchCounts: { 'button:has-text("Log In")': 1 },
    passingCandidates: ['button:has-text("Log In")'],
  });

  const result = await healFailure(S4, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('healed');
  expect(result.proposedSelector).toBe('button:has-text("Log In")');
  expect(result.toolCallCount).toBe(2);
});

test('scenario 5 gives up', async () => {
  const model = scriptedModel(
    [
      { toolCalls: [{ name: 'run_single_test', args: { candidate: '#password' } }] },
      { content: 'The element no longer exists on the page.' },
    ],
  );

  const toolbox = closableFakeToolbox({
    passingCandidates: [],
  });

  const result = await healFailure(S5, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('no-fix');
  expect(result.proposedSelector).toBeNull();
  expect(result.verified).toBe(false);
  expect(result.stopReason).toBe('model-gave-up');
});

test('scenario 5 exhausts the cap', async () => {
  const model = scriptedModel(
    [{ toolCalls: [{ name: 'run_single_test', args: { candidate: '#selector' } }] }],
    { repeatLast: true },
  );

  const toolbox = closableFakeToolbox({
    passingCandidates: [],
  });

  const result = await healFailure(S5, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.toolCallCount).toBe(5);
  expect(result.capReached).toBe(true);
  expect(result.stopReason).toBe('tool-call-cap-reached');
  expect(result.outcome).toBe('no-fix');
  expect(result.proposedSelector).toBeNull();
  expect(toolbox.calls()).toHaveLength(5);
});

test('scenario 5 with a confident model', async () => {
  const model = scriptedModel([
    {
      content: '#remember-me was renamed to #remember-preference. That is the fix.',
    },
  ]);

  const toolbox = closableFakeToolbox({
    passingCandidates: [],
  });

  const result = await healFailure(S5, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.proposedSelector).toBeNull();
  expect(result.outcome).toBe('no-fix');
});

// ============ Spec-source context ============

test('buildInitialMessages with null specSource omits spec block', async () => {
  const snapshot = {
    url: 'http://localhost:3100/',
    html: '<html><body></body></html>',
    estimatedTokens: 100,
    elementCount: 1,
    depthLimit: null,
    truncated: false,
    capturedAt: new Date().toISOString(),
  };

  const messages = buildInitialMessages(S1, 'http://localhost:3100/', snapshot, null);
  const userMessage = messages.find((m) => m.role === 'user');
  expect(userMessage).toBeDefined();
  expect(userMessage?.content).not.toContain('Current source of the spec file');
  expect(userMessage?.content).not.toContain('read-only');
});

test('buildInitialMessages with specSource includes spec block', async () => {
  const snapshot = {
    url: 'http://localhost:3100/',
    html: '<html><body></body></html>',
    estimatedTokens: 100,
    elementCount: 1,
    depthLimit: null,
    truncated: false,
    capturedAt: new Date().toISOString(),
  };

  const specSource = "import { test } from '@playwright/test';";
  const messages = buildInitialMessages(S1, 'http://localhost:3100/', snapshot, specSource);
  const userMessage = messages.find((m) => m.role === 'user');
  expect(userMessage).toBeDefined();
  expect(userMessage?.content).toContain('Current source of the spec file (read-only; you cannot edit it):');
  expect(userMessage?.content).toContain(specSource);
});

test('clampSpecSource handles short text', () => {
  const short = 'short';
  const clamped = clampSpecSource(short);
  expect(clamped).toBe(short);
});

test('clampSpecSource handles long text', () => {
  const long = 'x'.repeat(MAX_SPEC_SOURCE_CHARS + 500);
  const clamped = clampSpecSource(long);
  expect(clamped.length).toBeLessThanOrEqual(MAX_SPEC_SOURCE_CHARS + 20);
  expect(clamped).toContain('…[truncated]…');
});

test('healFailure records bootstrapSpecSource', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#test' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    passingCandidates: ['#test'],
  });

  const specSource = 'test source code';
  const result = await healFailure(S1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
    specSource,
  });

  expect(result.transcript.bootstrapSpecSource).toBe(specSource);
});

test('healFailure with no specSource sets bootstrapSpecSource to null', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#test' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    passingCandidates: ['#test'],
  });

  const result = await healFailure(S1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.transcript.bootstrapSpecSource).toBeNull();
});

test('spec source is not a channel to the toolbox', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'query_selector', args: { selector: '#signin-button' } }] },
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#signin-button' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    matchCounts: { '#signin-button': 1 },
    passingCandidates: ['#signin-button'],
  });

  const specSource = "page.locator('#evil')";
  await healFailure(S1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
    specSource,
  });

  for (const call of toolbox.calls()) {
    expect(call.arg).not.toBe('#evil');
  }
});

test('transcript with spec source is JSON-serializable', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#test' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    passingCandidates: ['#test'],
  });

  const specSource = 'test source code';
  const result = await healFailure(S1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
    specSource,
  });

  const serialized = JSON.parse(JSON.stringify(result.transcript));
  expect(serialized).toEqual(result.transcript);
});

// ============ Queue runner ============

test('healQueueSequentially runs two failures in order', async () => {
  const toolbox1 = closableFakeToolbox({
    passingCandidates: ['#sig'],
  });
  const toolbox2 = closableFakeToolbox({
    passingCandidates: ['#pb'],
  });

  const queueResult = await healQueueSequentially([S1, S2], {
    model: { model: 'test', createCompletion: async () => ({ content: '', toolCalls: [], finishReason: '', usage: null }) },
    appUrl: 'http://localhost:3100/',
    createToolbox: async (failure) => {
      const tb = failure.specFile === S1.specFile ? toolbox1 : toolbox2;
      return tb;
    },
    readSpecSource: async () => null,
  });

  expect(queueResult.results).toHaveLength(2);
  expect(queueResult.results[0]?.specFile).toBe(S1.specFile);
  expect(queueResult.results[1]?.specFile).toBe(S2.specFile);
  expect(toolbox1.closeCount()).toBe(1);
  expect(toolbox2.closeCount()).toBe(1);
});

test('healQueueSequentially continues on createToolbox error', async () => {
  const toolbox1 = closableFakeToolbox({
    passingCandidates: ['#sig'],
  });

  const result = await healQueueSequentially([S1, S2], {
    model: { model: 'test', createCompletion: async () => ({ content: '', toolCalls: [], finishReason: '', usage: null }) },
    appUrl: 'http://localhost:3100/',
    createToolbox: async (failure) => {
      if (failure.specFile === S2.specFile) {
        throw new Error('toolbox creation failed');
      }
      return toolbox1;
    },
    readSpecSource: async () => null,
  });

  expect(result.results).toHaveLength(2);
  expect(result.results[1]?.outcome).toBe('error');
  expect(result.results[1]?.stopReason).toBe('toolbox-error');
  expect(result.results[1]?.proposedSelector).toBeNull();
  expect(result.results[1]?.toolCallCount).toBe(0);
});

test('readSpecSource rejection does not abort the run', async () => {
  const toolbox = closableFakeToolbox({
    passingCandidates: ['#sig'],
  });

  const result = await healQueueSequentially([S1], {
    model: { model: 'test', createCompletion: async () => ({ content: '', toolCalls: [], finishReason: '', usage: null }) },
    appUrl: 'http://localhost:3100/',
    createToolbox: async () => toolbox,
    readSpecSource: async () => {
      throw new Error('read failed');
    },
  });

  expect(result.results).toHaveLength(1);
  expect(result.results[0]?.transcript.bootstrapSpecSource).toBeNull();
});

test('close is called on no-fix', async () => {
  const model = scriptedModel([
    { content: 'No fix found.' },
  ]);

  const toolbox = closableFakeToolbox({
    passingCandidates: [],
  });

  const result = await healQueueSequentially([S5], {
    model,
    appUrl: 'http://localhost:3100/',
    createToolbox: async () => toolbox,
    readSpecSource: async () => null,
  });

  expect(result.results[0]?.outcome).toBe('no-fix');
  expect(toolbox.closeCount()).toBe(1);
});

// ============ Verdict evaluation ============

test('SCENARIO_EXPECTATIONS has 5 entries', () => {
  expect(SCENARIO_EXPECTATIONS).toHaveLength(5);
  for (let i = 0; i < 5; i++) {
    const exp = SCENARIO_EXPECTATIONS[i];
    expect(exp).toBeDefined();
    expect(exp?.scenario).toBe(i + 1);
  }
});

test('only scenario 5 has null oracleSelector', () => {
  const nullOracles = SCENARIO_EXPECTATIONS.filter((e) => e.oracleSelector === null);
  expect(nullOracles).toHaveLength(1);
  expect(nullOracles[0]?.scenario).toBe(5);
});

test('scenario 5 healed fails evaluation', () => {
  const healResult: any = {
    specFile: 'tests/remember-preference.spec.ts',
    outcome: 'healed',
    proposedSelector: '#x',
    toolCallCount: 1,
    capReached: false,
    durationMs: 100,
  };

  const verdict = evaluateScenario(healResult, 'oracle-unavailable');
  expect(verdict.pass).toBe(false);
  expect(verdict.failureReasons).toContain('expected-no-fix-but-healed');
});

test('scenario 5 no-fix passes evaluation', () => {
  const healResult: any = {
    specFile: 'tests/remember-preference.spec.ts',
    outcome: 'no-fix',
    proposedSelector: null,
    toolCallCount: 1,
    capReached: false,
    durationMs: 100,
  };

  const verdict = evaluateScenario(healResult, null);
  expect(verdict.pass).toBe(true);
  expect(verdict.failureReasons).toHaveLength(0);
});

test('scenario 1 healed with wrong-element fails', () => {
  const healResult: any = {
    specFile: 'tests/login-submit.spec.ts',
    outcome: 'healed',
    proposedSelector: '#wrong',
    toolCallCount: 2,
    capReached: false,
    durationMs: 100,
  };

  const verdict = evaluateScenario(healResult, 'different');
  expect(verdict.pass).toBe(false);
  expect(verdict.failureReasons).toContain('wrong-element-fix');
});

test('scenario 1 healed with same element passes', () => {
  const healResult: any = {
    specFile: 'tests/login-submit.spec.ts',
    outcome: 'healed',
    proposedSelector: '#signin-button',
    toolCallCount: 2,
    capReached: false,
    durationMs: 100,
  };

  const verdict = evaluateScenario(healResult, 'same');
  expect(verdict.pass).toBe(true);
  expect(verdict.failureReasons).toHaveLength(0);
});

test('scenario 1 no-fix fails', () => {
  const healResult: any = {
    specFile: 'tests/login-submit.spec.ts',
    outcome: 'no-fix',
    proposedSelector: null,
    toolCallCount: 2,
    capReached: false,
    durationMs: 100,
  };

  const verdict = evaluateScenario(healResult, null);
  expect(verdict.pass).toBe(false);
  expect(verdict.failureReasons).toContain('expected-healed-but-not');
});

test('scenario 3 passes for both healed and no-fix', () => {
  const healedResult: any = {
    specFile: 'tests/product-price.spec.ts',
    outcome: 'healed',
    proposedSelector: '.product-card__price',
    toolCallCount: 2,
    capReached: false,
    durationMs: 100,
  };
  const noFixResult: any = {
    specFile: 'tests/product-price.spec.ts',
    outcome: 'no-fix',
    proposedSelector: null,
    toolCallCount: 2,
    capReached: false,
    durationMs: 100,
  };

  const healedVerdict = evaluateScenario(healedResult, 'same');
  expect(healedVerdict.pass).toBe(true);

  const noFixVerdict = evaluateScenario(noFixResult, null);
  expect(noFixVerdict.pass).toBe(true);
});

test('scenario 3 with proposed-not-unique fails', () => {
  const healResult: any = {
    specFile: 'tests/product-price.spec.ts',
    outcome: 'healed',
    proposedSelector: '.price',
    toolCallCount: 2,
    capReached: false,
    durationMs: 100,
  };

  const verdict = evaluateScenario(healResult, 'proposed-not-unique');
  expect(verdict.pass).toBe(false);
  expect(verdict.failureReasons).toContain('fix-not-unique');
});

test('unknown scenario fails', () => {
  const healResult: any = {
    specFile: 'tests/unknown.spec.ts',
    outcome: 'healed',
    proposedSelector: '#x',
    toolCallCount: 1,
    capReached: false,
    durationMs: 100,
  };

  const verdict = evaluateScenario(healResult, 'same');
  expect(verdict.pass).toBe(false);
  expect(verdict.failureReasons).toContain('unknown-scenario');
});

test('evaluateRun detects missing spec files', () => {
  const scenarios: any[] = [
    { specFile: 'tests/login-submit.spec.ts', pass: true },
  ];

  const verdict = evaluateRun(1, new Date().toISOString(), 100, scenarios, [
    'tests/login-submit.spec.ts',
    'tests/cart-add.spec.ts',
  ]);

  expect(verdict.missingSpecFiles).toContain('tests/cart-add.spec.ts');
  expect(verdict.pass).toBe(false);
});

test('summariseMatrix aggregates across runs', () => {
  const scenarios: any[] = [];
  for (const exp of SCENARIO_EXPECTATIONS) {
    scenarios.push({
      scenario: exp.scenario,
      specFile: exp.specFile,
      requiredOutcome: exp.requiredOutcome,
      pass: true,
      outcome: 'healed',
      stopReason: 'verified-fix',
      proposedSelector: exp.oracleSelector,
      toolCallCount: 2,
      capReached: false,
      durationMs: 100,
      identity: 'same',
      failureReasons: [],
    });
  }

  const run1: any = { run: 1, pass: true, scenarios, missingSpecFiles: [], startedAt: '2025-01-01T00:00:00Z', durationMs: 100 };
  const run2: any = { run: 2, pass: true, scenarios, missingSpecFiles: [], startedAt: '2025-01-01T00:00:00Z', durationMs: 100 };
  const run3: any = { run: 3, pass: true, scenarios, missingSpecFiles: [], startedAt: '2025-01-01T00:00:00Z', durationMs: 100 };

  const matrix = summariseMatrix('2025-01-01T00:00:00Z', 1000, 'gpt-4', [run1, run2, run3]);

  expect(matrix.runVerdicts).toHaveLength(3);
  expect(matrix.perScenario).toHaveLength(5);
  expect(matrix.perScenario[0]?.attempts).toBe(3);
});

test('MAX_TOOL_CALLS and MAX_MATRIX_RUNS defined', () => {
  expect(MAX_TOOL_CALLS).toBe(5);
  expect(MAX_TOOL_CALLS).toBe(5);
});

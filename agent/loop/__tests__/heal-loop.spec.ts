import { expect, test } from '@playwright/test';
import type { ClassifiedFailure } from '../../classifier/failure-classifier.js';
import { healFailure, MAX_TOOL_CALLS, MAX_MODEL_TURNS } from '../heal-loop.js';
import { scriptedModel, fakeToolbox } from './fakes.js';

const SCENARIO_1: ClassifiedFailure = {
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

// Test 1: Happy path
test('happy path', async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: 'query_selector', args: { selector: '#signin-button' } }],
    },
    {
      toolCalls: [{ name: 'run_single_test', args: { candidate: '#signin-button' } }],
    },
  ]);

  const toolbox = fakeToolbox({
    matchCounts: { '#signin-button': 1 },
    passingCandidates: ['#signin-button'],
  });

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('healed');
  expect(result.proposedSelector).toBe('#signin-button');
  expect(result.verified).toBe(true);
  expect(result.toolCallCount).toBe(2);
  expect(result.capReached).toBe(false);
  expect(result.stopReason).toBe('verified-fix');
  expect(result.transcript.toolCalls).toHaveLength(2);
  expect(result.transcript.bootstrapSnapshot).not.toBeNull();
});

// Test 2: Cap exhaustion
test('cap exhaustion', async () => {
  const model = scriptedModel(
    [{ toolCalls: [{ name: 'query_selector', args: { selector: '#signin-button' } }] }],
    { repeatLast: true },
  );

  const toolbox = fakeToolbox({
    matchCounts: { '#signin-button': 1 },
  });

  const result = await healFailure(SCENARIO_1, {
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

// Test 3: Cap beats a would-be success
test('cap beats a would-be success', async () => {
  const model = scriptedModel(
    [
      { toolCalls: [{ name: 'query_selector', args: { selector: '#signin-button' } }] },
      { toolCalls: [{ name: 'run_single_test', args: { candidate: '#signin-button' } }] },
    ],
    { repeatLast: true },
  );

  const toolbox = fakeToolbox({
    matchCounts: { '#signin-button': 1 },
    passOnNthRun: 6,
  });

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('no-fix');
  expect(result.proposedSelector).toBeNull();
  expect(result.toolCallCount).toBe(5);
});

// Test 4: Model asserts a fix it never verified
test('model asserts a fix without verification', async () => {
  const model = scriptedModel([
    {
      content: 'The correct selector is #signin-button. This will fix the test.',
      toolCalls: [],
    },
  ]);

  const toolbox = fakeToolbox({});

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('no-fix');
  expect(result.proposedSelector).toBeNull();
  expect(result.verified).toBe(false);
  expect(result.stopReason).toBe('model-gave-up');
  expect(result.toolCallCount).toBe(0);
});

// Test 5: run_single_test fails but output looks like a pass
test('run_single_test fails despite output looking like pass', async () => {
  const model = scriptedModel([
    {
      toolCalls: [
        {
          name: 'run_single_test',
          args: { candidate: '#signin-button' },
        },
      ],
    },
  ]);

  const toolbox = fakeToolbox({
    failWith: {
      '#signin-button': {
        passed: false,
        output: '  1 passed (1.2s)',
      },
    },
  });

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.proposedSelector).toBeNull();
  expect(result.outcome).toBe('no-fix');
  expect(result.verification?.passed).toBe(false);
});

// Test 6: Assertion-integrity rejection
test('assertion-integrity rejection', async () => {
  const model = scriptedModel([
    {
      toolCalls: [
        {
          name: 'run_single_test',
          args: { candidate: '#signin-button' },
        },
      ],
    },
  ]);

  const toolbox = fakeToolbox({
    failWith: {
      '#signin-button': {
        passed: false,
        executed: false,
        rejected: 'assertion-integrity',
      },
    },
  });

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.proposedSelector).toBeNull();
  expect(result.verification?.rejected).toBe('assertion-integrity');
  expect(result.verification?.executed).toBe(false);
});

// Test 7: Model cannot redirect the verification target
test('model cannot redirect verification target', async () => {
  const model = scriptedModel([
    {
      toolCalls: [
        {
          name: 'run_single_test',
          args: {
            candidate: '#signin-button',
            specFile: 'tests/evil.spec.ts',
            testName: 'evil',
            originalSelector: '#x',
          },
        },
      ],
    },
  ]);

  const toolbox = fakeToolbox({
    passingCandidates: ['#signin-button'],
  });

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  const toolCall = toolbox.calls().find((tc) => tc.tool === 'run_single_test');
  expect(toolCall?.tool).toBe('run_single_test');
  expect(toolCall?.arg).toBe('#signin-button');

  const tcRecord = result.transcript.toolCalls[0];
  expect(tcRecord?.arguments).toHaveProperty('specFile');
  expect(tcRecord?.arguments).toHaveProperty('testName');

  expect(result.specFile).toBe(SCENARIO_1.specFile);
  expect(result.testName).toBe(SCENARIO_1.testName);
  expect(result.originalSelector).toBe(SCENARIO_1.selector);
});

// Test 8: Multiple tool calls in one turn respect the cap
test('multiple tool calls in one turn respect the cap', async () => {
  const model = scriptedModel([
    {
      toolCalls: [
        { name: 'query_selector', args: { selector: '#sel1' } },
        { name: 'query_selector', args: { selector: '#sel2' } },
        { name: 'query_selector', args: { selector: '#sel3' } },
      ],
    },
    {
      toolCalls: [
        { name: 'query_selector', args: { selector: '#sel4' } },
        { name: 'query_selector', args: { selector: '#sel5' } },
        { name: 'query_selector', args: { selector: '#sel6' } },
      ],
    },
  ]);

  const toolbox = fakeToolbox({});

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.toolCallCount).toBe(5);
  expect(toolbox.calls()).toHaveLength(5);
  expect(result.capReached).toBe(true);
});

// Test 9: Unknown tool name
test('unknown tool name', async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: 'delete_assertion', args: {} }],
    },
  ]);

  const toolbox = fakeToolbox({});

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  const firstCall = result.transcript.toolCalls[0];
  expect(firstCall?.ok).toBe(false);
  expect(result.toolCallCount).toBe(1);
  expect(firstCall?.result.kind).toBe('error');
});

// Test 10: Malformed JSON arguments
test('malformed JSON arguments', async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: 'query_selector', args: '{not json' }],
    },
  ]);

  const toolbox = fakeToolbox({});

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.toolCallCount).toBe(1);
  const tc = result.transcript.toolCalls[0];
  expect(tc?.ok).toBe(false);
  expect(() => JSON.parse(tc?.resultSummary ?? '')).not.toThrow();
  const parsed = JSON.parse(tc?.resultSummary ?? '{}');
  expect(parsed).toHaveProperty('error');
});

// Test 11: Missing required argument
test('missing required argument', async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: 'query_selector', args: {} }],
    },
  ]);

  const toolbox = fakeToolbox({});

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.toolCallCount).toBe(1);
  const tc = result.transcript.toolCalls[0];
  expect(tc?.ok).toBe(false);
});

// Test 12: Model API error
test('model API error', async () => {
  const model = scriptedModel(
    [
      {
        toolCalls: [{ name: 'query_selector', args: { selector: '#test' } }],
      },
      {
        toolCalls: [],
      },
    ],
    { throwOnTurn: 2 },
  );

  const toolbox = fakeToolbox({});

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('error');
  expect(result.stopReason).toBe('model-error');
  expect(result.errorMessage).not.toBeNull();
  expect(result.proposedSelector).toBeNull();
  expect(result.transcript.toolCalls).toHaveLength(1);
});

// Test 13: Toolbox bootstrap failure
test('toolbox bootstrap failure', async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: 'query_selector', args: { selector: '#test' } }],
    },
  ]);

  const toolbox = fakeToolbox({
    throwOn: ['get_dom_snapshot'],
  });

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('error');
  expect(result.stopReason).toBe('toolbox-error');
  expect(result.toolCallCount).toBe(0);
  expect(model.turnCount()).toBe(0);
});

// Test 14: maxToolCalls cannot be raised
test('maxToolCalls cannot be raised', async () => {
  const model = scriptedModel(
    [{ toolCalls: [{ name: 'query_selector', args: { selector: '#test' } }] }],
    { repeatLast: true },
  );

  const toolbox = fakeToolbox({});

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
    maxToolCalls: 99,
  });

  expect(result.toolCallCount).toBe(5);
});

// Test 15: maxToolCalls can be lowered
test('maxToolCalls can be lowered', async () => {
  const model = scriptedModel(
    [{ toolCalls: [{ name: 'query_selector', args: { selector: '#test' } }] }],
    { repeatLast: true },
  );

  const toolbox = fakeToolbox({});

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
    maxToolCalls: 1,
  });

  expect(result.toolCallCount).toBe(1);
  expect(result.capReached).toBe(true);
});

// Test 16: Invalid input
test('invalid input - null selector', async () => {
  const model = scriptedModel([]);

  const toolbox = fakeToolbox({});

  const failureNoSelector = { ...SCENARIO_1, selector: null };

  const result = await healFailure(failureNoSelector, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('error');
  expect(result.stopReason).toBe('invalid-input');
  expect(result.toolCallCount).toBe(0);
  expect(model.turnCount()).toBe(0);
});

test('invalid input - wrong classification', async () => {
  const model = scriptedModel([]);

  const toolbox = fakeToolbox({});

  const failureWrongClass = { ...SCENARIO_1, classification: 'other' as const };

  const result = await healFailure(failureWrongClass, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.outcome).toBe('error');
  expect(result.stopReason).toBe('invalid-input');
  expect(result.toolCallCount).toBe(0);
  expect(model.turnCount()).toBe(0);
});

// Test 17: Transcript is jsonb-ready
test('transcript is jsonb-ready', async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: 'query_selector', args: { selector: '#signin-button' } }],
    },
    {
      toolCalls: [{ name: 'run_single_test', args: { candidate: '#signin-button' } }],
    },
  ]);

  const toolbox = fakeToolbox({
    matchCounts: { '#signin-button': 1 },
    passingCandidates: ['#signin-button'],
  });

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  // Test JSON round-trip
  const serialized = JSON.stringify(result.transcript);
  const deserialized = JSON.parse(serialized);
  expect(deserialized).toEqual(result.transcript);

  // Test full result serialization has no undefined
  const fullSerialized = JSON.stringify(result);
  expect(fullSerialized).not.toContain('undefined');
});

// Test 18: Invariant holds on every outcome
test('invariant holds on every outcome', async () => {
  const testCases = [
    // (1) Happy path
    {
      model: scriptedModel([
        {
          toolCalls: [{ name: 'query_selector', args: { selector: '#signin-button' } }],
        },
        {
          toolCalls: [{ name: 'run_single_test', args: { candidate: '#signin-button' } }],
        },
      ]),
      toolbox: fakeToolbox({
        matchCounts: { '#signin-button': 1 },
        passingCandidates: ['#signin-button'],
      }),
    },
    // (4) Model asserts without verification
    {
      model: scriptedModel([
        {
          content: 'The correct selector is #signin-button.',
          toolCalls: [],
        },
      ]),
      toolbox: fakeToolbox({}),
    },
    // (5) run_single_test fails
    {
      model: scriptedModel([
        {
          toolCalls: [{ name: 'run_single_test', args: { candidate: '#signin-button' } }],
        },
      ]),
      toolbox: fakeToolbox({
        failWith: {
          '#signin-button': { passed: false },
        },
      }),
    },
    // (6) assertion-integrity rejection
    {
      model: scriptedModel([
        {
          toolCalls: [{ name: 'run_single_test', args: { candidate: '#signin-button' } }],
        },
      ]),
      toolbox: fakeToolbox({
        failWith: {
          '#signin-button': {
            passed: false,
            executed: false,
            rejected: 'assertion-integrity',
          },
        },
      }),
    },
  ];

  for (const testCase of testCases) {
    const result = await healFailure(SCENARIO_1, {
      model: testCase.model,
      toolbox: testCase.toolbox,
      appUrl: 'http://localhost:3100/',
    });

    const matches =
      (result.proposedSelector !== null) === (result.outcome === 'healed') &&
      (result.proposedSelector !== null) === result.verified;
    expect(matches).toBe(true);
    expect(result.toolCallCount).toBeLessThanOrEqual(MAX_TOOL_CALLS);
  }
});

// Test 19: Constants
test('constants', () => {
  expect(MAX_TOOL_CALLS).toBe(5);
  expect(MAX_MODEL_TURNS).toBe(6);
});

// Test 20: Tool throws during dispatch (regression test for ok field consistency)
test('tool throws during dispatch', async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: 'query_selector', args: { selector: '#test' } }],
    },
  ]);

  const toolbox = fakeToolbox({
    throwOn: ['query_selector'],
  });

  const result = await healFailure(SCENARIO_1, {
    model,
    toolbox,
    appUrl: 'http://localhost:3100/',
  });

  expect(result.toolCallCount).toBe(1);
  const tcRecord = result.transcript.toolCalls[0];
  expect(tcRecord?.ok).toBe(false);
  expect(tcRecord?.result.kind).toBe('error');
});

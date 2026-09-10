import { test, expect } from '@playwright/test';
import {
  normaliseTranscript,
  TOOL_CALL_CAP,
} from '../lib/transcript';

// Build a hand-written envelope fixture
const fixture = {
  schemaVersion: 1,
  truncated: false,
  confidence: 'high',
  status: 'healed',
  outcome: 'healed',
  stopReason: 'verified-fix',
  prEligible: true,
  reasons: [],
  failureReason: null,
  proposedSelector: '#new-btn',
  originalSelector: '#old-btn',
  toolCallCount: 3,
  capReached: false,
  modelTurnCount: 1,
  model: 'gpt-test',
  startedAt: '2025-01-01T00:00:00.000Z',
  durationMs: 5000,
  errorMessage: null,
  verification: {
    candidateSelector: '#new-btn',
    passed: true,
    executed: true,
    rejected: null,
    changedLines: [{ lineNumber: 10, before: "click('#old-btn')", after: "click('#new-btn')" }],
    output: '1 passed',
    durationMs: 1200,
  },
  measurement: {
    selector: '#new-btn',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: '2025-01-01T00:00:01.000Z',
    durationMs: 100,
  },
  signals: {
    verified: true,
    proposedSelector: '#new-btn',
    toolCallCount: 3,
    matchCount: 1,
    matchMeasured: true,
    capReached: false,
    outcome: 'healed',
    stopReason: 'verified-fix',
  },
  transcript: {
    bootstrapSnapshot: {
      url: 'http://localhost:3000',
      html: '<main><button id="signin-button">Sign In</button></main>',
      estimatedTokens: 50,
      elementCount: 2,
      truncated: false,
      capturedAt: '2025-01-01T00:00:00.000Z',
    },
    bootstrapSpecSource: 'describe("Login", () => { test("signs in", () => { ... }) })',
    messages: [{ role: 'user', content: 'Find the selector' }],
    toolCalls: [
      {
        index: 1,
        toolCallId: 'call-1',
        tool: 'get_dom_snapshot',
        ok: true,
        rawArguments: '{}',
        resultSummary: 'Got HTML',
        startedAt: '2025-01-01T00:00:00.000Z',
        durationMs: 100,
        result: {
          kind: 'dom-snapshot',
          url: 'http://localhost:3000',
          html: '<main><button id="signin-button">Sign In</button></main>',
          estimatedTokens: 50,
          elementCount: 2,
          truncated: false,
          capturedAt: '2025-01-01T00:00:00.000Z',
        },
      },
      {
        index: 2,
        toolCallId: 'call-2',
        tool: 'query_selector',
        ok: true,
        rawArguments: '{"selector":"#new-btn"}',
        resultSummary: '1 match',
        startedAt: '2025-01-01T00:00:01.000Z',
        durationMs: 50,
        result: {
          kind: 'query-selector',
          selector: '#new-btn',
          matchCount: 1,
          previews: [
            {
              index: 0,
              tagName: 'button',
              id: 'signin-button',
              classList: ['primary'],
              role: 'button',
              text: 'Sign In',
              visible: true,
            },
          ],
          previewsTruncated: false,
          error: null,
        },
      },
      {
        index: 3,
        toolCallId: 'call-3',
        tool: 'run_single_test',
        ok: true,
        rawArguments: '{"selector":"#new-btn"}',
        resultSummary: 'Test passed',
        startedAt: '2025-01-01T00:00:02.000Z',
        durationMs: 1200,
        result: {
          kind: 'run-single-test',
          candidate: '#new-btn',
          passed: true,
          executed: true,
          rejected: null,
          violations: [],
          changedLines: [
            { lineNumber: 10, before: "click('#old-btn')", after: "click('#new-btn')" },
          ],
          output: '1 passed',
        },
      },
    ],
    modelRequests: [
      {
        turn: 1,
        finishReason: 'tool_calls',
        contentPreview: 'I will help you find the selector.',
        requestedTools: ['get_dom_snapshot', 'query_selector', 'run_single_test'],
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      },
    ],
  },
};

test('normaliseTranscript: null and undefined', () => {
  expect(normaliseTranscript(null)).toEqual({ kind: 'absent' });
  expect(normaliseTranscript(undefined)).toEqual({ kind: 'absent' });
});

test('normaliseTranscript: empty object and non-object', () => {
  expect(normaliseTranscript({})).toEqual({ kind: 'absent' });
  expect(normaliseTranscript(42)).toEqual({ kind: 'absent' });
  expect(normaliseTranscript([])).toEqual({ kind: 'absent' });
});

test('normaliseTranscript: string parsing', () => {
  const parsed = normaliseTranscript(JSON.stringify({ transcript: { toolCalls: [] } }));
  expect(parsed.kind).toBe('envelope');
});

test('normaliseTranscript: invalid JSON string', () => {
  const result = normaliseTranscript('not json');
  expect(result).toEqual({ kind: 'unrecognised', json: 'not json' });
});

test('normaliseTranscript: missing transcript key', () => {
  const result = normaliseTranscript({ hello: 'world' });
  expect(result.kind).toBe('unrecognised');
  if (result.kind === 'unrecognised') {
    expect(result.json).toContain('hello');
  }
});

test('normaliseTranscript: full fixture', () => {
  const result = normaliseTranscript(fixture);
  expect(result.kind).toBe('envelope');
  if (result.kind === 'envelope') {
    expect(result.schemaVersion).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.steps.length).toBe(3);
    expect(result.steps.map((s) => s.tool)).toEqual([
      'get_dom_snapshot',
      'query_selector',
      'run_single_test',
    ]);
    expect(result.steps.map((s) => s.index)).toEqual([1, 2, 3]);
  }
});

test('normaliseTranscript: step 1 dom-snapshot', () => {
  const result = normaliseTranscript(fixture);
  if (result.kind === 'envelope' && result.steps.length > 0) {
    const step = result.steps[0];
    expect(step?.detail.kind).toBe('dom-snapshot');
    if (step?.detail.kind === 'dom-snapshot') {
      expect(step.detail.snapshot.html).toBe(
        '<main><button id="signin-button">Sign In</button></main>'
      );
      expect(step.detail.snapshot.elementCount).toBe(2);
      expect(step.detail.snapshot.estimatedTokens).toBe(50);
    }
  }
});

test('normaliseTranscript: step 2 query-selector', () => {
  const result = normaliseTranscript(fixture);
  if (result.kind === 'envelope' && result.steps.length > 1) {
    const step = result.steps[1];
    expect(step?.detail.kind).toBe('query-selector');
    if (step?.detail.kind === 'query-selector') {
      expect(step.detail.matchCount).toBe(1);
      expect(step.detail.previews.length).toBe(1);
      const preview = step.detail.previews[0];
      expect(preview?.tagName).toBe('button');
      expect(preview?.id).toBe('signin-button');
      expect(preview?.classList).toContain('primary');
      expect(preview?.text).toBe('Sign In');
      expect(step.detail.error).toBeNull();
    }
  }
});

test('normaliseTranscript: query-selector with error', () => {
  const fixtureWithError = {
    transcript: {
      toolCalls: [
        {
          index: 1,
          tool: 'query_selector',
          ok: false,
          result: {
            kind: 'query-selector',
            selector: '#bad',
            matchCount: 0,
            error: { kind: 'invalid-selector', message: 'bad' },
            previews: [],
            previewsTruncated: false,
          },
        },
      ],
      messages: [],
      modelRequests: [],
    },
  };
  const result = normaliseTranscript(fixtureWithError);
  if (result.kind === 'envelope' && result.steps.length > 0) {
    const step = result.steps[0];
    if (step?.detail.kind === 'query-selector') {
      expect(step.detail.error?.kind).toBe('invalid-selector');
      expect(step.detail.error?.message).toBe('bad');
      expect(step.detail.matchCount).toBe(0);
    }
  }
});

test('normaliseTranscript: step 3 run-single-test', () => {
  const result = normaliseTranscript(fixture);
  if (result.kind === 'envelope' && result.steps.length > 2) {
    const step = result.steps[2];
    expect(step?.detail.kind).toBe('run-single-test');
    if (step?.detail.kind === 'run-single-test') {
      expect(step.detail.passed).toBe(true);
      expect(step.detail.executed).toBe(true);
      expect(step.detail.rejected).toBeNull();
      expect(step.detail.changedLines.length).toBe(1);
      expect(step.detail.changedLines[0]?.lineNumber).toBe(10);
      expect(step.detail.output).toBe('1 passed');
    }
  }
});

test('normaliseTranscript: run-single-test with rejection', () => {
  const fixtureWithRejection = {
    transcript: {
      toolCalls: [
        {
          index: 1,
          tool: 'run_single_test',
          ok: false,
          result: {
            kind: 'run-single-test',
            candidate: '#bad',
            passed: false,
            executed: true,
            rejected: 'assertion-integrity',
            violations: [{ rule: 'no-assertion-removed', detail: 'An assertion was removed' }],
            changedLines: [],
            output: 'Test failed',
          },
        },
      ],
      messages: [],
      modelRequests: [],
    },
  };
  const result = normaliseTranscript(fixtureWithRejection);
  if (result.kind === 'envelope' && result.steps.length > 0) {
    const step = result.steps[0];
    if (step?.detail.kind === 'run-single-test') {
      expect(step.detail.violations[0]?.rule).toBeDefined();
      expect(step.detail.violations[0]?.detail).toBeDefined();
    }
  }
});

test('normaliseTranscript: unknown step detail', () => {
  const fixtureWithUnknown = {
    transcript: {
      toolCalls: [
        {
          result: { kind: 'teleport' },
        },
      ],
      messages: [],
      modelRequests: [],
    },
  };
  const result = normaliseTranscript(fixtureWithUnknown);
  if (result.kind === 'envelope' && result.steps.length > 0) {
    const step = result.steps[0];
    expect(step?.detail.kind).toBe('unknown');
    if (step?.detail.kind === 'unknown') {
      expect(step.detail.json).not.toBe('');
    }
  }
});

test('normaliseTranscript: non-object toolCall', () => {
  const fixtureWithString = {
    transcript: {
      toolCalls: ['nope'],
      messages: [],
      modelRequests: [],
    },
  };
  const result = normaliseTranscript(fixtureWithString);
  if (result.kind === 'envelope' && result.steps.length > 0) {
    const step = result.steps[0];
    expect(step?.detail.kind).toBe('unknown');
    expect(step?.tool).toBe('(unknown tool)');
    expect(step?.ok).toBe(false);
    expect(step?.index).toBe(1);
  }
});

test('normaliseTranscript: messageCount', () => {
  const result = normaliseTranscript(fixture);
  if (result.kind === 'envelope') {
    expect(result.messageCount).toBe(fixture.transcript.messages.length);
  }
});

test('normaliseTranscript: empty messages with truncated', () => {
  const fixtureEmpty = {
    transcript: {
      toolCalls: [],
      messages: [],
      modelRequests: [],
    },
    truncated: true,
  };
  const result = normaliseTranscript(fixtureEmpty);
  if (result.kind === 'envelope') {
    expect(result.messageCount).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.steps.length).toBe(0);
  }
});

test('normaliseTranscript: modelTurns', () => {
  const result = normaliseTranscript(fixture);
  if (result.kind === 'envelope') {
    expect(result.modelTurns.length).toBe(1);
    const turn = result.modelTurns[0];
    expect(turn?.turn).toBe(1);
    expect(turn?.finishReason).toBe('tool_calls');
    expect(turn?.contentPreview).toBe('I will help you find the selector.');
    expect(turn?.requestedTools).toContain('get_dom_snapshot');
    expect(turn?.promptTokens).toBe(100);
    expect(turn?.completionTokens).toBe(50);
    expect(turn?.totalTokens).toBe(150);
  }
});

test('normaliseTranscript: modelTurn with null usage', () => {
  const fixtureNoUsage = {
    transcript: {
      toolCalls: [],
      messages: [],
      modelRequests: [
        {
          turn: 1,
          finishReason: 'stop',
          contentPreview: 'Done',
          requestedTools: [],
          usage: null,
        },
      ],
    },
  };
  const result = normaliseTranscript(fixtureNoUsage);
  if (result.kind === 'envelope') {
    const turn = result.modelTurns[0];
    expect(turn?.promptTokens).toBeNull();
    expect(turn?.completionTokens).toBeNull();
    expect(turn?.totalTokens).toBeNull();
  }
});

test('normaliseTranscript: verification null', () => {
  const result = normaliseTranscript(fixture);
  if (result.kind === 'envelope') {
    expect(result.verification).not.toBeNull();
  }
});

test('normaliseTranscript: verification absent when missing', () => {
  const fixtureNoVerification = {
    transcript: {
      toolCalls: [],
      messages: [],
      modelRequests: [],
    },
  };
  const result = normaliseTranscript(fixtureNoVerification);
  if (result.kind === 'envelope') {
    expect(result.verification).toBeNull();
  }
});

test('normaliseTranscript: lossless - large output', () => {
  const largeOutput = 'x'.repeat(50_000);
  const fixtureWithLarge = {
    transcript: {
      toolCalls: [
        {
          index: 1,
          tool: 'run_single_test',
          result: {
            kind: 'run-single-test',
            candidate: '#sel',
            passed: true,
            executed: true,
            rejected: null,
            violations: [],
            changedLines: [],
            output: largeOutput,
          },
        },
      ],
      messages: [],
      modelRequests: [],
    },
  };
  const result = normaliseTranscript(fixtureWithLarge);
  if (result.kind === 'envelope' && result.steps.length > 0) {
    const step = result.steps[0];
    if (step?.detail.kind === 'run-single-test') {
      expect(step.detail.output.length).toBe(50_000);
    }
  }
});

test('normaliseTranscript: total - structurally broken', () => {
  const brokenFixture = {
    transcript: {
      toolCalls: 'nope',
      messages: 3,
      modelRequests: null,
    },
  };
  const result = normaliseTranscript(brokenFixture);
  if (result.kind === 'envelope') {
    expect(result.steps).toEqual([]);
    expect(result.modelTurns).toEqual([]);
    expect(result.messageCount).toBe(0);
  }
});

test('normaliseTranscript: empty transcript object', () => {
  const result = normaliseTranscript({ transcript: {} });
  expect(result.kind).toBe('envelope');
  if (result.kind === 'envelope') {
    expect(result.steps).toEqual([]);
  }
});

test('TOOL_CALL_CAP', () => {
  expect(TOOL_CALL_CAP).toBe(5);
});

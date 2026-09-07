import { test, expect } from '@playwright/test';
import { assessHealResult } from '../../agent/loop/confidence.js';
import type { HealResult } from '../../agent/loop/types.js';
import {
  buildTranscriptEnvelope,
  clampDeep,
  serialiseTranscript,
  TRUNCATED_FIELD_CHARS,
  TRUNCATION_MARKER,
} from '../transcript.js';

// Helper to create a minimal HealResult for testing
function makeHealResult(overrides?: Partial<HealResult>): HealResult {
  return {
    specFile: 'tests/example.spec.ts',
    testName: 'should work',
    originalSelector: '#btn',
    proposedSelector: '.btn-primary',
    outcome: 'healed',
    stopReason: 'verified-fix',
    verified: true,
    toolCallCount: 1,
    capReached: false,
    modelTurnCount: 1,
    verification: {
      candidateSelector: '.btn-primary',
      passed: true,
      executed: true,
      rejected: null,
      changedLines: [],
      output: '',
      durationMs: 100,
    },
    transcript: {
      bootstrapSnapshot: {
        url: 'http://localhost:3000',
        html: '<html><body><button id="btn">Click</button></body></html>',
        estimatedTokens: 50,
        elementCount: 1,
        truncated: false,
        capturedAt: '2025-01-01T00:00:00Z',
      },
      bootstrapSpecSource: null,
      messages: [
        {
          role: 'user',
          content: 'Fix the selector',
        },
        {
          role: 'assistant',
          content: 'I found a fix',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'run_single_test',
                arguments: '{"candidateSelector": ".btn-primary"}',
              },
            },
          ],
        },
      ],
      toolCalls: [
        {
          index: 1,
          toolCallId: 'call_1',
          tool: 'run_single_test',
          rawArguments: '{"candidateSelector": ".btn-primary"}',
          arguments: { candidateSelector: '.btn-primary' },
          ok: true,
          result: {
            kind: 'run-single-test',
            candidate: '.btn-primary',
            passed: true,
            executed: true,
            rejected: null,
            violations: [],
            changedLines: [],
            output: '',
          },
          resultSummary: 'passed',
          startedAt: '2025-01-01T00:00:00Z',
          durationMs: 100,
        },
      ],
      modelRequests: [
        {
          turn: 1,
          finishReason: 'tool_calls',
          usage: null,
          contentPreview: 'I found a fix',
          requestedTools: ['run_single_test'],
        },
      ],
    },
    model: 'gpt-4',
    startedAt: '2025-01-01T00:00:00Z',
    durationMs: 500,
    errorMessage: null,
    ...overrides,
  };
}

test('1. high-confidence healed assessment produces envelope with correct fields', () => {
  const result = makeHealResult();
  const assessment = assessHealResult(result, {
    selector: '.btn-primary',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: '2025-01-01T00:00:01Z',
    durationMs: 50,
  });

  const envelope = buildTranscriptEnvelope(assessment);

  expect(envelope.schemaVersion).toBe(1);
  expect(envelope.truncated).toBe(false);
  expect(envelope.confidence).toBe('high');
  expect(envelope.status).toBe('healed');
  expect(envelope.transcript.toolCalls).toHaveLength(1);
});

test('2. buildTranscriptEnvelope preserves bootstrap snapshot byte-for-byte', () => {
  const html = '<html><body><button id="btn">Test</button></body></html>';
  const result = makeHealResult({
    transcript: {
      bootstrapSnapshot: {
        url: 'http://localhost:3000',
        html,
        estimatedTokens: 50,
        elementCount: 1,
        truncated: false,
        capturedAt: '2025-01-01T00:00:00Z',
      },
      bootstrapSpecSource: null,
      messages: [],
      toolCalls: [],
      modelRequests: [],
    },
  });

  const assessment = assessHealResult(result, null);
  const envelope = buildTranscriptEnvelope(assessment);

  expect(envelope.transcript.bootstrapSnapshot?.html).toBe(html);
});

test('3. clampDeep truncates strings and preserves structure', () => {
  const input = {
    a: 'x'.repeat(10),
    b: ['y'.repeat(10)],
    c: 3,
    d: null,
  };

  const result = clampDeep(input, 4);

  expect(result).toEqual({
    a: 'xxxx' + TRUNCATION_MARKER,
    b: ['yyyy' + TRUNCATION_MARKER],
    c: 3,
    d: null,
  });
});

test('4. clampDeep leaves strings at exactly maxChars length unchanged', () => {
  const input = {
    short: 'abc',
    exact: 'abcd',
    long: 'abcde',
  };

  const result = clampDeep(input, 4);

  expect(result).toEqual({
    short: 'abc',
    exact: 'abcd',
    long: 'abcd' + TRUNCATION_MARKER,
  });
});

test('5. serialiseTranscript on small assessment returns truncated=false with parseable json', () => {
  const result = makeHealResult();
  const assessment = assessHealResult(result, null);

  const serialised = serialiseTranscript(assessment);

  expect(serialised.truncated).toBe(false);
  const parsed = JSON.parse(serialised.json);
  expect(parsed.transcript.messages).toHaveLength(2);
});

test('6. serialiseTranscript on huge snapshot truncates messages and clamps strings', () => {
  const hugeHtml = 'x'.repeat(3_000_000);
  const result = makeHealResult({
    transcript: {
      bootstrapSnapshot: {
        url: 'http://localhost:3000',
        html: hugeHtml,
        estimatedTokens: 1000000,
        elementCount: 1,
        truncated: false,
        capturedAt: '2025-01-01T00:00:00Z',
      },
      bootstrapSpecSource: null,
      messages: [{ role: 'user', content: 'Fix this' }],
      toolCalls: [],
      modelRequests: [],
    },
  });

  const assessment = assessHealResult(result, null);
  const serialised = serialiseTranscript(assessment);

  expect(serialised.truncated).toBe(true);
  const parsed = JSON.parse(serialised.json);
  expect(parsed.transcript.messages).toEqual([]);
  expect(parsed.transcript.bootstrapSnapshot.html.length).toBe(
    TRUNCATED_FIELD_CHARS + TRUNCATION_MARKER.length,
  );
});

test('7. failed assessment serialises with truncated=false and null proposedSelector', () => {
  const result = makeHealResult({
    proposedSelector: null,
    verified: false,
    outcome: 'no-fix',
    stopReason: 'model-gave-up',
  });

  const assessment = assessHealResult(result, null);
  const serialised = serialiseTranscript(assessment);

  expect(serialised.truncated).toBe(false);
  const parsed = JSON.parse(serialised.json);
  expect(parsed.proposedSelector).toBeNull();
  expect(parsed.reasons.length).toBeGreaterThan(0);
});

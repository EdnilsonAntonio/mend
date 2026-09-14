import { test, expect } from '@playwright/test';
import type { MetricsAttemptRow } from '../types.js';
import {
  auditFalseFixes,
  buildMetricsReport,
  computeCost,
  computeCounts,
  computeHealRate,
  computeScenarios,
  computeToolCalls,
  TOOL_CALL_CAP,
} from '../compute.js';
import { formatMetricsReport } from '../format.js';

// Factory for creating a clean healed/high row
function row(overrides: Partial<MetricsAttemptRow>): MetricsAttemptRow {
  return {
    id: 'attempt-1',
    testRunId: 'run-1',
    specFile: 'tests/login-submit.spec.ts',
    testName: 'test 1',
    originalSelector: '#login-btn',
    proposedSelector: '#signin-button',
    confidence: 'high',
    toolCallCount: 1,
    status: 'healed',
    failureReason: null,
    prUrl: null,
    createdAt: '2025-01-01T00:00:00Z',
    transcriptModel: 'gpt-4o-mini',
    transcriptOutcome: 'success',
    transcriptConfidence: 'high',
    transcriptProposedSelector: '#signin-button',
    transcriptTruncated: false,
    verificationPresent: true,
    verificationPassed: true,
    verificationExecuted: true,
    verificationRejected: null,
    verificationCandidate: '#signin-button',
    runTestCalls: [
      {
        candidate: '#signin-button',
        passed: true,
        executed: true,
        rejected: null,
        violationCount: 0,
      },
    ],
    modelUsages: [
      {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 2_000_000,
      },
    ],
    ...overrides,
  };
}

test('clean rows produce zero false fixes', () => {
  const rows = [row({}), row({ id: 'attempt-2' })];
  const result = auditFalseFixes(rows);
  expect(result.falseFixes).toBe(0);
  expect(result.falseFixRate).toBe(0);
});

test('heal rate: 3 healed + 1 needs_review + 1 failed + 1 investigating', () => {
  const rows = [
    row({ id: 'attempt-1', status: 'healed' }),
    row({ id: 'attempt-2', status: 'healed' }),
    row({ id: 'attempt-3', status: 'healed' }),
    row({ id: 'attempt-4', status: 'needs_review', confidence: 'low' }),
    row({ id: 'attempt-5', status: 'failed', confidence: 'none', proposedSelector: null }),
    row({ id: 'attempt-6', status: 'investigating', confidence: 'none', proposedSelector: null }),
  ];
  const counts = computeCounts(rows);
  const healRate = computeHealRate(rows);
  expect(counts.settled).toBe(5);
  expect(counts.stranded).toBe(1);
  expect(healRate.healRate).toBe(0.6);
  expect(healRate.verifiedFixRate).toBe(0.8);
});

test('zero rows produce null rates and zero counts', () => {
  const rows: MetricsAttemptRow[] = [];
  const report = buildMetricsReport(rows, { testRunId: null, since: null }, '2025-01-01T00:00:00Z');
  expect(report.counts.attempts).toBe(0);
  expect(report.healRate.healRate).toBeNull();
  expect(report.falseFix.falseFixRate).toBeNull();
  expect(report.toolCalls.settledMean).toBeNull();
});

test('PR-delivery failure row has zero false-fix findings', () => {
  const rows = [
    row({
      id: 'attempt-1',
      status: 'needs_review',
      confidence: 'low',
      failureReason: 'pr-delivery-failed: 500 boom',
      transcriptConfidence: 'high',
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(0);
  expect(result.falseFixes).toBe(0);
});

test('tool calls: rows with [0,1,2,5] tool calls', () => {
  const rows = [
    row({ id: 'attempt-1', toolCallCount: 0 }),
    row({ id: 'attempt-2', toolCallCount: 1 }),
    row({ id: 'attempt-3', toolCallCount: 2 }),
    row({ id: 'attempt-4', toolCallCount: 5 }),
  ];
  const toolCalls = computeToolCalls(rows);
  expect(toolCalls.settledMean).toBe(2);
  expect(toolCalls.max).toBe(5);
  expect(toolCalls.capReachedCount).toBe(1);
  expect(toolCalls.distribution['5']).toBe(1);
  expect(toolCalls.distribution['3']).toBe(0);
});

test('cost: two rows with 1M tokens each, gpt-4o-mini', () => {
  const rows = [
    row({
      id: 'attempt-1',
      modelUsages: [
        {
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
          totalTokens: 2_000_000,
        },
      ],
    }),
    row({
      id: 'attempt-2',
      modelUsages: [
        {
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
          totalTokens: 2_000_000,
        },
      ],
    }),
  ];
  const cost = computeCost(rows);
  expect(cost.promptTokens).toBe(2_000_000);
  expect(cost.completionTokens).toBe(2_000_000);
  expect(cost.totalTokens).toBe(4_000_000);
  expect(cost.totalCostUsd).toBe(2 * (0.15 + 0.6));
  expect(cost.complete).toBe(true);
});

test('cost coverage: one row with empty modelUsages', () => {
  const rows = [
    row({
      id: 'attempt-1',
      modelUsages: [],
    }),
  ];
  const cost = computeCost(rows);
  expect(cost.usageCoverage).toBeLessThan(1);
  expect(cost.complete).toBe(false);
});

test('cost: unknown model is excluded from total', () => {
  const rows = [
    row({
      id: 'attempt-1',
      transcriptModel: 'unknown-model',
      modelUsages: [
        {
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
          totalTokens: 2_000_000,
        },
      ],
    }),
  ];
  const cost = computeCost(rows);
  expect(cost.unpricedModels).toContain('unknown-model');
  expect(cost.totalCostUsd).toBeNull();
});

// False-fix codes tests
test('fix-without-verification', () => {
  const rows = [
    row({
      id: 'attempt-1',
      verificationPresent: false,
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('fix-without-verification');
  expect(result.falseFixes).toBe(1);
});

test('fix-without-passing-verification', () => {
  const rows = [
    row({
      id: 'attempt-1',
      verificationPresent: true,
      verificationPassed: false,
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('fix-without-passing-verification');
  expect(result.falseFixes).toBe(1);
});

test('fix-without-matching-passing-run', () => {
  const rows = [
    row({
      id: 'attempt-1',
      proposedSelector: '#new-selector',
      transcriptProposedSelector: '#new-selector',
      runTestCalls: [
        {
          candidate: '#different-selector',
          passed: true,
          executed: true,
          rejected: null,
          violationCount: 0,
        },
      ],
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('fix-without-matching-passing-run');
  expect(result.falseFixes).toBe(1);
});

test('fix-with-integrity-violation', () => {
  const rows = [
    row({
      id: 'attempt-1',
      proposedSelector: '#selector',
      transcriptProposedSelector: '#selector',
      runTestCalls: [
        {
          candidate: '#selector',
          passed: true,
          executed: true,
          rejected: 'assertion violation',
          violationCount: 1,
        },
      ],
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('fix-with-integrity-violation');
  expect(result.falseFixes).toBe(1);
});

test('transcript-selector-mismatch', () => {
  const rows = [
    row({
      id: 'attempt-1',
      proposedSelector: '#selector-1',
      transcriptProposedSelector: '#selector-2',
      runTestCalls: [
        {
          candidate: '#selector-1',
          passed: true,
          executed: true,
          rejected: null,
          violationCount: 0,
        },
      ],
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('transcript-selector-mismatch');
  expect(result.falseFixes).toBe(1);
});

test('healed-without-high-transcript-confidence', () => {
  const rows = [
    row({
      id: 'attempt-1',
      status: 'healed',
      transcriptConfidence: 'low',
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('healed-without-high-transcript-confidence');
  expect(result.falseFixes).toBe(1);
});

test('pr-url-without-healed-high', () => {
  const rows = [
    row({
      id: 'attempt-1',
      status: 'needs_review',
      confidence: 'low',
      prUrl: 'https://github.com/pr/123',
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('pr-url-without-healed-high');
  expect(result.falseFixes).toBe(1);
});

test('tool-call-cap-exceeded', () => {
  const rows = [
    row({
      id: 'attempt-1',
      toolCallCount: TOOL_CALL_CAP + 1,
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('tool-call-cap-exceeded');
  expect(result.falseFixes).toBe(1);
});

test('status-confidence-mismatch', () => {
  const rows = [
    row({
      id: 'attempt-1',
      status: 'healed',
      confidence: 'low',
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('status-confidence-mismatch');
  expect(result.falseFixes).toBe(1);
});

test('fix-for-unfixable-scenario', () => {
  const rows = [
    row({
      id: 'attempt-1',
      specFile: 'tests/remember-preference.spec.ts',
      proposedSelector: '#some-selector',
      transcriptProposedSelector: '#some-selector',
      runTestCalls: [
        {
          candidate: '#some-selector',
          passed: true,
          executed: true,
          rejected: null,
          violationCount: 0,
        },
      ],
    }),
  ];
  const result = auditFalseFixes(rows);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe('fix-for-unfixable-scenario');
  expect(result.falseFixes).toBe(1);
});

test('scenario section: scenario 5 with failed attempt has zero false fixes', () => {
  const rows = [
    row({
      id: 'attempt-1',
      specFile: 'tests/remember-preference.spec.ts',
      status: 'failed',
      confidence: 'none',
      proposedSelector: null,
    }),
  ];
  const scenarios = computeScenarios(rows);
  const scenario5 = scenarios.find(s => s.scenario === 5);
  expect(scenario5).toBeDefined();
  expect(scenario5?.falseFixes).toBe(0);
});

test('scenario section: scenario 5 with verified fix has one false fix', () => {
  const rows = [
    row({
      id: 'attempt-1',
      specFile: 'tests/remember-preference.spec.ts',
      status: 'healed',
      confidence: 'high',
      proposedSelector: '#some-selector',
    }),
  ];
  const scenarios = computeScenarios(rows);
  const scenario5 = scenarios.find(s => s.scenario === 5);
  expect(scenario5).toBeDefined();
  expect(scenario5?.falseFixes).toBe(1);
});

test('formatMetricsReport contains expected substrings', () => {
  const rows = [
    row({ id: 'attempt-1', status: 'healed' }),
    row({ id: 'attempt-2', status: 'healed' }),
    row({ id: 'attempt-3', status: 'healed' }),
    row({ id: 'attempt-4', status: 'needs_review', confidence: 'low' }),
    row({ id: 'attempt-5', status: 'failed', confidence: 'none', proposedSelector: null }),
  ];
  const report = buildMetricsReport(rows, { testRunId: null, since: null }, '2025-01-01T00:00:00Z');
  const formatted = formatMetricsReport(report);
  expect(formatted).toContain('heal rate');
  expect(formatted).toContain('false-fix rate');
  expect(formatted).toContain('usd per heal');
  expect(formatted).toContain('tool calls mean');
});

test('formatMetricsReport with partial cost contains [PARTIAL]', () => {
  const rows = [
    row({
      id: 'attempt-1',
      modelUsages: [],
    }),
  ];
  const report = buildMetricsReport(rows, { testRunId: null, since: null }, '2025-01-01T00:00:00Z');
  const formatted = formatMetricsReport(report);
  expect(formatted).toContain('[PARTIAL]');
});

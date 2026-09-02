import { expect, test } from '@playwright/test';
import type { ClassifiedFailure } from '../../classifier/failure-classifier.js';
import {
  assessHealResult,
  assertConfidenceInvariant,
  assertPrEligible,
  CONFIDENCE_THRESHOLDS,
  collectConfidenceSignals,
  ConfidenceSignals,
  deriveConfidence,
  measureVerifiedFix,
  summariseConfidence,
} from '../confidence.js';
import { MAX_TOOL_CALLS } from '../heal-loop.js';
import { healQueueSequentially } from '../heal-queue.js';
import type { HealResult, HealToolbox } from '../types.js';
import type { SelectorErrorKind } from '../../tools/query-selector.js';
import { closableFakeToolbox, scriptedModel } from './fakes.js';

// Test helpers
function signals(overrides: Partial<ConfidenceSignals>): ConfidenceSignals {
  return {
    verified: false,
    proposedSelector: null,
    toolCallCount: 0,
    matchCount: null,
    matchMeasured: false,
    capReached: false,
    outcome: 'no-fix',
    stopReason: 'model-gave-up',
    ...overrides,
  };
}

function healResultFixture(overrides: Partial<HealResult>): HealResult {
  return {
    specFile: 'tests/test.spec.ts',
    testName: 'test',
    originalSelector: '#orig',
    proposedSelector: null,
    outcome: 'no-fix',
    stopReason: 'model-gave-up',
    verified: false,
    toolCallCount: 0,
    capReached: false,
    modelTurnCount: 0,
    verification: null,
    transcript: {
      bootstrapSnapshot: null,
      bootstrapSpecSource: null,
      messages: [],
      toolCalls: [],
      modelRequests: [],
    },
    model: 'test-model',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    errorMessage: null,
    ...overrides,
  };
}

const F1: ClassifiedFailure = {
  classification: 'selector-drift',
  specFile: 'tests/login-submit.spec.ts',
  testName: 'submitting valid credentials updates the login status',
  projectName: 'chromium',
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

// --- The rules ---

test('rule 1: verified, matchCount=1, toolCallCount=1 => high', () => {
  const v = deriveConfidence(
    signals({
      verified: true,
      proposedSelector: '#sig',
      toolCallCount: 1,
      matchCount: 1,
      matchMeasured: true,
    }),
  );
  expect(v.confidence).toBe('high');
  expect(v.status).toBe('healed');
  expect(v.prEligible).toBe(true);
  expect(v.reasons).toEqual([]);
  expect(v.failureReason).toBeNull();
});

test('rule 2: verified, matchCount=1, toolCallCount=2 (boundary) => high', () => {
  const v = deriveConfidence(
    signals({
      verified: true,
      proposedSelector: '#sig',
      toolCallCount: 2,
      matchCount: 1,
      matchMeasured: true,
    }),
  );
  expect(v.confidence).toBe('high');
});

test('rule 3: verified, matchCount=1, toolCallCount=3 (boundary) => low', () => {
  const v = deriveConfidence(
    signals({
      verified: true,
      proposedSelector: '#sig',
      toolCallCount: 3,
      matchCount: 1,
      matchMeasured: true,
    }),
  );
  expect(v.confidence).toBe('low');
  expect(v.status).toBe('needs_review');
  expect(v.prEligible).toBe(false);
  expect(v.reasons).toEqual(['too-many-tool-calls']);
});

test('rule 4: verified, matchCount=2 => low with ambiguous-match', () => {
  const v = deriveConfidence(
    signals({
      verified: true,
      proposedSelector: '#sig',
      toolCallCount: 2,
      matchCount: 2,
      matchMeasured: true,
    }),
  );
  expect(v.confidence).toBe('low');
  expect(v.reasons).toEqual(['ambiguous-match']);
});

test('rule 5: verified, matchCount=0 => low with no-match-on-idle-page', () => {
  const v = deriveConfidence(
    signals({
      verified: true,
      proposedSelector: '#sig',
      toolCallCount: 2,
      matchCount: 0,
      matchMeasured: true,
    }),
  );
  expect(v.confidence).toBe('low');
  expect(v.reasons).toEqual(['no-match-on-idle-page']);
});

test('rule 6: verified, matchMeasured=false => low with match-count-unavailable', () => {
  const v = deriveConfidence(
    signals({
      verified: true,
      proposedSelector: '#sig',
      toolCallCount: 1,
      matchCount: null,
      matchMeasured: false,
    }),
  );
  expect(v.confidence).toBe('low');
  expect(v.reasons).toEqual(['match-count-unavailable']);
});

test('rule 7: verified, matchCount=3, toolCallCount=5 => low with multiple reasons in order', () => {
  const v = deriveConfidence(
    signals({
      verified: true,
      proposedSelector: '#sig',
      toolCallCount: 5,
      matchCount: 3,
      matchMeasured: true,
    }),
  );
  expect(v.confidence).toBe('low');
  expect(v.reasons).toEqual(['ambiguous-match', 'too-many-tool-calls']);
});

test('rule 8: not verified, outcome=no-fix, capReached=false => none', () => {
  const v = deriveConfidence(
    signals({
      verified: false,
      outcome: 'no-fix',
      capReached: false,
    }),
  );
  expect(v.confidence).toBe('none');
  expect(v.status).toBe('failed');
  expect(v.prEligible).toBe(false);
  expect(v.reasons).toEqual(['no-verified-fix']);
});

test('rule 9: not verified, capReached=true => none with cap-reached-without-fix', () => {
  const v = deriveConfidence(
    signals({
      verified: false,
      capReached: true,
      stopReason: 'tool-call-cap-reached',
    }),
  );
  expect(v.reasons).toEqual(['no-verified-fix', 'cap-reached-without-fix']);
});

test('rule 10: not verified, outcome=error => none with heal-error', () => {
  const v = deriveConfidence(
    signals({
      verified: false,
      outcome: 'error',
      stopReason: 'model-error',
    }),
  );
  expect(v.reasons).toEqual(['no-verified-fix', 'heal-error']);
});

test('rule 11: failureReason === reasons.join comma for non-high', () => {
  const v = deriveConfidence(
    signals({
      verified: true,
      proposedSelector: '#sig',
      toolCallCount: 5,
      matchCount: 3,
      matchMeasured: true,
    }),
  );
  expect(v.failureReason).toBe(v.reasons.join(','));
});

// --- Exhaustive invariant sweep ---

test('exhaustive invariant sweep', () => {
  const verifiedValues = [true, false];
  const matchCountValues = [null, 0, 1, 2, 9];
  const toolCallCountValues = [0, 1, 2, 3, 4, 5];
  const capReachedValues = [true, false];
  const outcomeValues = ['healed', 'no-fix', 'error'] as const;

  let seenHigh = false;
  let seenLow = false;
  let seenNone = false;

  for (const verified of verifiedValues) {
    for (const matchCount of matchCountValues) {
      for (const toolCallCount of toolCallCountValues) {
        for (const capReached of capReachedValues) {
          for (const outcome of outcomeValues) {
            const matchMeasured = matchCount !== null;
            const proposedSelector = verified ? '#sig' : null;

            const s = signals({
              verified,
              proposedSelector,
              matchCount,
              matchMeasured,
              toolCallCount,
              capReached,
              outcome,
            });

            const verdict = deriveConfidence(s);

            // Invariant 1: prEligible === (confidence === 'high')
            expect(verdict.prEligible).toBe(verdict.confidence === 'high');

            // Invariant 2: none => failed, !prEligible
            if (verdict.confidence === 'none') {
              expect(verdict.status).toBe('failed');
              expect(verdict.prEligible).toBe(false);
            }

            // Invariant 3: high => all conditions
            if (verdict.confidence === 'high') {
              expect(s.verified).toBe(true);
              expect(s.matchCount).toBe(1);
              expect(s.toolCallCount).toBeLessThanOrEqual(2);
            }

            // Invariant 4: verified => not none
            if (s.verified) {
              expect(verdict.confidence).not.toBe('none');
            }

            // Invariant 5: reasons empty iff high
            expect((verdict.reasons.length === 0) === (verdict.confidence === 'high')).toBe(true);

            // Invariant 6: failureReason null iff high
            expect((verdict.failureReason === null) === (verdict.confidence === 'high')).toBe(true);

            // Invariant 7: status matches confidence
            const statusMap: Record<typeof verdict.confidence, typeof verdict.status> = {
              high: 'healed',
              low: 'needs_review',
              none: 'failed',
            };
            expect(verdict.status).toBe(statusMap[verdict.confidence]);

            if (verdict.confidence === 'high') seenHigh = true;
            if (verdict.confidence === 'low') seenLow = true;
            if (verdict.confidence === 'none') seenNone = true;
          }
        }
      }
    }
  }

  // We saw at least one of each
  expect(seenHigh).toBe(true);
  expect(seenLow).toBe(true);
  expect(seenNone).toBe(true);
});

// --- Thresholds ---

test('thresholds have correct values', () => {
  expect(CONFIDENCE_THRESHOLDS.exactMatchCount).toBe(1);
  expect(CONFIDENCE_THRESHOLDS.maxToolCallsForHigh).toBe(2);
  expect(CONFIDENCE_THRESHOLDS.maxToolCallsForHigh).toBeLessThan(MAX_TOOL_CALLS);
});

// --- Signals and assessment ---

test('collectConfidenceSignals copies fields from result and measurement', () => {
  const result = healResultFixture({
    verified: true,
    proposedSelector: '#sig',
    toolCallCount: 2,
    capReached: false,
    outcome: 'healed',
    stopReason: 'verified-fix',
  });
  const measurement = {
    selector: '#sig',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: new Date().toISOString(),
    durationMs: 10,
  };

  const s = collectConfidenceSignals(result, measurement);
  expect(s.verified).toBe(true);
  expect(s.proposedSelector).toBe('#sig');
  expect(s.toolCallCount).toBe(2);
  expect(s.matchCount).toBe(1);
  expect(s.matchMeasured).toBe(true);
  expect(s.capReached).toBe(false);
  expect(s.outcome).toBe('healed');
  expect(s.stopReason).toBe('verified-fix');
});

test('ConfidenceSignals has exactly eight keys', () => {
  const s = signals({});
  const keys = Object.keys(s).sort();
  expect(keys).toEqual([
    'capReached',
    'matchCount',
    'matchMeasured',
    'outcome',
    'proposedSelector',
    'stopReason',
    'toolCallCount',
    'verified',
  ]);
});

test('unverified result with measurement still assesses to none', () => {
  const result = healResultFixture({
    verified: false,
    proposedSelector: null,
  });
  const measurement = {
    selector: '#sig',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: new Date().toISOString(),
    durationMs: 10,
  };

  const assessment = assessHealResult(result, measurement);
  expect(assessment.confidence).toBe('none');
});

test('assessment is JSON-serializable', () => {
  const result = healResultFixture({
    verified: true,
    proposedSelector: '#sig',
    toolCallCount: 1,
    verification: {
      candidateSelector: '#sig',
      passed: true,
      executed: true,
      rejected: null,
      changedLines: [],
      output: '',
      durationMs: 100,
    },
  });
  const measurement = {
    selector: '#sig',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: new Date().toISOString(),
    durationMs: 10,
  };

  const assessment = assessHealResult(result, measurement);
  const serialized = JSON.stringify(assessment);
  const deserialized = JSON.parse(serialized);

  expect(deserialized).toEqual(assessment);
});

// --- Guards ---

test('assertConfidenceInvariant throws for none with prEligible=true', () => {
  const result = healResultFixture({ verified: false, proposedSelector: null });
  const measurement = null;
  const assessment = assessHealResult(result, measurement);

  // Manually forge a bad assessment
  const badAssessment = { ...assessment, prEligible: true };
  expect(() => assertConfidenceInvariant(badAssessment)).toThrow();
});

test('assertConfidenceInvariant throws for high with matchCount=2', () => {
  const result = healResultFixture({
    verified: true,
    proposedSelector: '#sig',
    toolCallCount: 1,
    verification: {
      candidateSelector: '#sig',
      passed: true,
      executed: true,
      rejected: null,
      changedLines: [],
      output: '',
      durationMs: 100,
    },
  });
  const measurement = {
    selector: '#sig',
    matchCount: 2,
    measured: true,
    error: null,
    measuredAt: new Date().toISOString(),
    durationMs: 10,
  };

  const assessment = assessHealResult(result, measurement);
  const badAssessment = { ...assessment, confidence: 'high' as const, status: 'healed' as const };
  expect(() => assertConfidenceInvariant(badAssessment)).toThrow();
});

test('assertConfidenceInvariant throws for high without verification', () => {
  const result = healResultFixture({
    verified: true,
    proposedSelector: '#sig',
    toolCallCount: 1,
    verification: null,
  });
  const measurement = {
    selector: '#sig',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: new Date().toISOString(),
    durationMs: 10,
  };

  const badAssessment = {
    result,
    measurement,
    signals: signals({
      verified: true,
      proposedSelector: '#sig',
      toolCallCount: 1,
      matchCount: 1,
      matchMeasured: true,
    }),
    confidence: 'high' as const,
    status: 'healed' as const,
    prEligible: true,
    reasons: [],
    failureReason: null,
  };

  expect(() => assertConfidenceInvariant(badAssessment)).toThrow();
});

test('assertPrEligible throws for low', () => {
  const result = healResultFixture({
    verified: true,
    proposedSelector: '#sig',
    toolCallCount: 3,
  });
  const measurement = {
    selector: '#sig',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: new Date().toISOString(),
    durationMs: 10,
  };

  const assessment = assessHealResult(result, measurement);
  expect(() => assertPrEligible(assessment)).toThrow();
});

test('assertPrEligible throws for none', () => {
  const result = healResultFixture({ verified: false });
  const assessment = assessHealResult(result, null);
  expect(() => assertPrEligible(assessment)).toThrow();
});

test('assertPrEligible does not throw for genuine high', () => {
  const result = healResultFixture({
    verified: true,
    proposedSelector: '#sig',
    toolCallCount: 1,
    verification: {
      candidateSelector: '#sig',
      passed: true,
      executed: true,
      rejected: null,
      changedLines: [],
      output: '',
      durationMs: 100,
    },
  });
  const measurement = {
    selector: '#sig',
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: new Date().toISOString(),
    durationMs: 10,
  };

  const assessment = assessHealResult(result, measurement);
  expect(() => assertPrEligible(assessment)).not.toThrow();
});

// --- Measurement ---

test('measureVerifiedFix returns null when proposedSelector is null', async () => {
  const toolbox = closableFakeToolbox({});
  const result = healResultFixture({ proposedSelector: null });

  const measurement = await measureVerifiedFix(toolbox, result);
  expect(measurement).toBeNull();
  expect(toolbox.calls()).toHaveLength(0);
});

test('measureVerifiedFix returns measured=true with matchCount from toolbox', async () => {
  const toolbox = closableFakeToolbox({ matchCounts: { '#sig': 1 } });
  const result = healResultFixture({ proposedSelector: '#sig' });

  const measurement = await measureVerifiedFix(toolbox, result);
  expect(measurement).not.toBeNull();
  expect(measurement!.selector).toBe('#sig');
  expect(measurement!.matchCount).toBe(1);
  expect(measurement!.measured).toBe(true);
  expect(measurement!.error).toBeNull();
  expect(toolbox.calls()).toHaveLength(1);
  expect(toolbox.calls()[0]!.tool).toBe('query_selector');
});

test('measureVerifiedFix resolves with measured=false when toolbox throws', async () => {
  const toolbox = closableFakeToolbox({ throwOn: ['query_selector'] });
  const result = healResultFixture({ proposedSelector: '#sig' });

  const measurement = await measureVerifiedFix(toolbox, result);
  expect(measurement).not.toBeNull();
  expect(measurement!.measured).toBe(false);
  expect(measurement!.matchCount).toBeNull();
  expect(measurement!.error).not.toBeNull();
});

test('measureVerifiedFix handles non-null querySelector error', async () => {
  const toolbox: HealToolbox = {
    getDomSnapshot: async () => ({
      url: 'http://localhost/',
      html: '<html></html>',
      estimatedTokens: 10,
      elementCount: 1,
      depthLimit: null,
      truncated: false,
      capturedAt: new Date().toISOString(),
    }),
    querySelector: async () => ({
      selector: '#sig',
      matchCount: 0,
      previews: [],
      previewsTruncated: false,
      error: { kind: 'invalid-selector' as SelectorErrorKind, message: 'bad selector' },
    }),
    runSingleTest: async () => ({
      passed: false,
      output: '',
      executed: true,
      exitCode: 1,
      timedOut: false,
      rejected: null,
      violations: [],
      specFile: 'test.spec.ts',
      testName: 'test',
      originalSelector: '#orig',
      candidateSelector: '#sig',
      proposedSource: 'source',
      changedLines: [],
      durationMs: 100,
    }),
  };

  const result = healResultFixture({ proposedSelector: '#sig' });
  const measurement = await measureVerifiedFix(toolbox, result);
  expect(measurement!.measured).toBe(false);
  expect(measurement!.matchCount).toBeNull();
  expect(measurement!.error).toBe('bad selector');
});

// --- Queue integration ---

test('queue integration: healed with high confidence', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'query_selector', args: { selector: '#sig' } }] },
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#sig' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    matchCounts: { '#sig': 1 },
    passingCandidates: ['#sig'],
  });

  const queueResult = await healQueueSequentially([F1], {
    model,
    appUrl: 'http://localhost:3100/',
    createToolbox: async () => toolbox,
    readSpecSource: async () => null,
  });

  expect(queueResult.assessments).toHaveLength(1);
  expect(queueResult.assessments[0]!.confidence).toBe('high');
  expect(queueResult.assessments[0]!.status).toBe('healed');
  expect(queueResult.assessments[0]!.prEligible).toBe(true);
  expect(queueResult.assessments[0]!.result).toBe(queueResult.results[0]);
});

test('queue: measurement is not counted as tool call', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'query_selector', args: { selector: '#sig' } }] },
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#sig' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    matchCounts: { '#sig': 1 },
    passingCandidates: ['#sig'],
  });

  const queueResult = await healQueueSequentially([F1], {
    model,
    appUrl: 'http://localhost:3100/',
    createToolbox: async () => toolbox,
    readSpecSource: async () => null,
  });

  expect(queueResult.results[0]!.toolCallCount).toBe(2);
  expect(queueResult.results[0]!.transcript.toolCalls).toHaveLength(2);
  expect(toolbox.calls()).toHaveLength(3); // query_selector (model), run_single_test (model), query_selector (measurement)
});

test('queue: no-fix yields none confidence', async () => {
  const model = scriptedModel([{ toolCalls: [] }]);

  const toolbox = closableFakeToolbox({});

  const queueResult = await healQueueSequentially([F1], {
    model,
    appUrl: 'http://localhost:3100/',
    createToolbox: async () => toolbox,
    readSpecSource: async () => null,
  });

  expect(queueResult.assessments[0]!.confidence).toBe('none');
  expect(queueResult.assessments[0]!.status).toBe('failed');
  expect(queueResult.assessments[0]!.prEligible).toBe(false);
  expect(queueResult.assessments[0]!.measurement).toBeNull();
});

test('queue: toolbox error still produces assessment', async () => {
  const model = scriptedModel([]);

  const queueResult = await healQueueSequentially([F1], {
    model,
    appUrl: 'http://localhost:3100/',
    createToolbox: async () => {
      throw new Error('toolbox failed');
    },
    readSpecSource: async () => null,
  });

  expect(queueResult.results).toHaveLength(1);
  expect(queueResult.assessments).toHaveLength(1);
  expect(queueResult.assessments[0]!.confidence).toBe('none');
});

test('queue: toolbox close count is 1', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'query_selector', args: { selector: '#sig' } }] },
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#sig' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    matchCounts: { '#sig': 1 },
    passingCandidates: ['#sig'],
  });

  await healQueueSequentially([F1], {
    model,
    appUrl: 'http://localhost:3100/',
    createToolbox: async () => toolbox,
    readSpecSource: async () => null,
  });

  expect(toolbox.closeCount()).toBe(1);
});

test('queue: ambiguous fix yields low confidence', async () => {
  const model = scriptedModel([
    { toolCalls: [{ name: 'query_selector', args: { selector: '#sig' } }] },
    { toolCalls: [{ name: 'run_single_test', args: { candidate: '#sig' } }] },
  ]);

  const toolbox = closableFakeToolbox({
    matchCounts: { '#sig': 3 },
    passingCandidates: ['#sig'],
  });

  const queueResult = await healQueueSequentially([F1], {
    model,
    appUrl: 'http://localhost:3100/',
    createToolbox: async () => toolbox,
    readSpecSource: async () => null,
  });

  expect(queueResult.assessments[0]!.confidence).toBe('low');
  expect(queueResult.assessments[0]!.status).toBe('needs_review');
  expect(queueResult.assessments[0]!.prEligible).toBe(false);
  expect(queueResult.assessments[0]!.failureReason).toContain('ambiguous-match');
});

// --- Aggregation ---

test('summariseConfidence counts correctly', () => {
  const assessmentData = [
    { confidence: 'high' as const, verified: true, toolCallCount: 1, matchCount: 1 },
    { confidence: 'high' as const, verified: true, toolCallCount: 2, matchCount: 1 },
    { confidence: 'low' as const, verified: true, toolCallCount: 5, matchCount: 3 },
    { confidence: 'none' as const, verified: false, toolCallCount: 0, matchCount: null },
  ];

  const totals = summariseConfidence(
    assessmentData.map((a) =>
      assessHealResult(
        healResultFixture({
          verified: a.verified,
          proposedSelector: a.verified ? '#sig' : null,
          toolCallCount: a.toolCallCount,
          verification: a.verified
            ? {
                candidateSelector: '#sig',
                passed: true,
                executed: true,
                rejected: null,
                changedLines: [],
                output: '',
                durationMs: 100,
              }
            : null,
        }),
        a.verified
          ? {
              selector: '#sig',
              matchCount: a.matchCount,
              measured: true,
              error: null,
              measuredAt: new Date().toISOString(),
              durationMs: 10,
            }
          : null,
      ),
    ),
  );

  expect(totals.attempts).toBe(4);
  expect(totals.high).toBe(2);
  expect(totals.low).toBe(1);
  expect(totals.none).toBe(1);
  expect(totals.prEligible).toBe(2);
  expect(totals.prEligible).toBe(totals.high);
});

test('summariseConfidence on empty array returns zeros', () => {
  const totals = summariseConfidence([]);
  expect(totals.attempts).toBe(0);
  expect(totals.high).toBe(0);
  expect(totals.low).toBe(0);
  expect(totals.none).toBe(0);
  expect(totals.prEligible).toBe(0);
});

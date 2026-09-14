import type {
  CostSection, CountsSection, FalseFixFinding, FalseFixSection, HealRateSection,
  MetricsAttemptRow, MetricsReport, MetricsScope, ScenarioRow, ToolCallSection,
} from './types.js';
import { TOOL_CALL_COUNT_CEILING } from '../db/schema-contract.js';
import { PR_DELIVERY_FAILURE_REASON_PREFIX } from '../db/repository.js';
import { SCENARIO_EXPECTATIONS } from '../agent/loop/scenario-matrix.js';
import { normaliseModelId, lookupModelPrice, costUsd } from './pricing.js';

export const TOOL_CALL_CAP = TOOL_CALL_COUNT_CEILING;

export function isSettled(row: MetricsAttemptRow): boolean {
  return row.status !== 'investigating';
}

export function hasVerifiedFix(row: MetricsAttemptRow): boolean {
  return isSettled(row) && row.proposedSelector !== null;
}

export function isPrDeliveryFailure(row: MetricsAttemptRow): boolean {
  return (
    row.status === 'needs_review' &&
    row.failureReason !== null &&
    row.failureReason.startsWith(PR_DELIVERY_FAILURE_REASON_PREFIX)
  );
}

// Helper to round to specified decimal places
function round(value: number, dp: number): number {
  return Number(value.toFixed(dp));
}

export function rate(numerator: number, denominator: number, dp: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return round(numerator / denominator, dp);
}

export function computeCounts(rows: readonly MetricsAttemptRow[]): CountsSection {
  let settled = 0;
  let stranded = 0;
  let healed = 0;
  let needsReview = 0;
  let failed = 0;
  let withProposedFix = 0;
  let withPrUrl = 0;
  let prDeliveryFailures = 0;

  const testRunIds = new Set<string>();

  for (const row of rows) {
    testRunIds.add(row.testRunId);

    if (isSettled(row)) {
      settled++;
      if (row.status === 'healed') {
        healed++;
      } else if (row.status === 'needs_review') {
        needsReview++;
      } else if (row.status === 'failed') {
        failed++;
      }
    } else {
      stranded++;
    }

    if (row.proposedSelector !== null && isSettled(row)) {
      withProposedFix++;
    }

    if (row.prUrl !== null) {
      withPrUrl++;
    }

    if (isPrDeliveryFailure(row)) {
      prDeliveryFailures++;
    }
  }

  return {
    attempts: rows.length,
    settled,
    stranded,
    healed,
    needsReview,
    failed,
    withProposedFix,
    withPrUrl,
    prDeliveryFailures,
    testRuns: testRunIds.size,
  };
}

export function computeHealRate(rows: readonly MetricsAttemptRow[]): HealRateSection {
  const settledRows = rows.filter(isSettled);
  const healed = settledRows.filter(r => r.status === 'healed').length;
  const verifiedFixes = settledRows.filter(r => r.status === 'healed' || r.status === 'needs_review').length;

  return {
    healed,
    settled: settledRows.length,
    healRate: rate(healed, settledRows.length, 4),
    verifiedFixes,
    verifiedFixRate: rate(verifiedFixes, settledRows.length, 4),
  };
}

export function computeToolCalls(rows: readonly MetricsAttemptRow[]): ToolCallSection {
  const settledRows = rows.filter(isSettled);
  const healedRows = settledRows.filter(r => r.status === 'healed');
  const verifiedFixRows = settledRows.filter(hasVerifiedFix);

  // Compute means
  const settledMean = settledRows.length > 0
    ? round(
        settledRows.reduce((sum, r) => sum + r.toolCallCount, 0) / settledRows.length,
        2,
      )
    : null;

  const healedMean = healedRows.length > 0
    ? round(
        healedRows.reduce((sum, r) => sum + r.toolCallCount, 0) / healedRows.length,
        2,
      )
    : null;

  const verifiedFixMean = verifiedFixRows.length > 0
    ? round(
        verifiedFixRows.reduce((sum, r) => sum + r.toolCallCount, 0) / verifiedFixRows.length,
        2,
      )
    : null;

  // Max
  const max = settledRows.length > 0
    ? Math.max(...settledRows.map(r => r.toolCallCount))
    : null;

  // Cap reached count
  const capReachedCount = settledRows.filter(r => r.toolCallCount === TOOL_CALL_CAP).length;

  // Distribution
  const distribution: Record<string, number> = {};
  for (let i = 0; i <= TOOL_CALL_CAP; i++) {
    distribution[String(i)] = 0;
  }
  for (const row of settledRows) {
    const key = String(row.toolCallCount);
    if (key in distribution) {
      const val = distribution[key];
      if (val !== undefined) {
        distribution[key] = val + 1;
      }
    }
  }

  return {
    settledMean,
    healedMean,
    verifiedFixMean,
    max,
    capReachedCount,
    distribution: distribution as Readonly<Record<string, number>>,
  };
}

export function computeCost(rows: readonly MetricsAttemptRow[]): CostSection {
  const settledRows = rows.filter(isSettled);
  let promptTokens = 0;
  let completionTokens = 0;
  let attemptsWithUsage = 0;
  let attemptsWithPricedModel = 0;
  let totalCost = 0;
  const unpricedModelIds = new Set<string>();
  const pricedModelIds = new Set<string>();

  for (const row of settledRows) {
    let rowPromptTokens = 0;
    let rowCompletionTokens = 0;
    let rowHasUsage = false;

    for (const usage of row.modelUsages) {
      if (usage.promptTokens !== null) {
        rowPromptTokens += usage.promptTokens;
        rowHasUsage = true;
      }
      if (usage.completionTokens !== null) {
        rowCompletionTokens += usage.completionTokens;
        rowHasUsage = true;
      }
    }

    promptTokens += rowPromptTokens;
    completionTokens += rowCompletionTokens;

    if (rowHasUsage) {
      attemptsWithUsage++;
      const price = lookupModelPrice(row.transcriptModel);
      if (price !== null) {
        attemptsWithPricedModel++;
        totalCost += costUsd(price, rowPromptTokens, rowCompletionTokens);
        // Track successfully priced models
        const modelId = row.transcriptModel === null ? '(unknown)' : normaliseModelId(row.transcriptModel);
        pricedModelIds.add(modelId);
      } else {
        // Track unpriced models
        const modelId = row.transcriptModel === null ? '(unknown)' : normaliseModelId(row.transcriptModel);
        unpricedModelIds.add(modelId);
      }
    }
  }

  const totalTokens = promptTokens + completionTokens;
  const usageCoverage = rate(attemptsWithUsage, settledRows.length, 4);
  const totalCostUsd = attemptsWithPricedModel === 0 ? null : round(totalCost, 6);
  const costPerAttemptUsd = totalCostUsd === null || settledRows.length === 0
    ? null
    : round(totalCostUsd / settledRows.length, 6);

  // Cost per healed: divide by healed count, not settled count
  const healedCount = settledRows.filter(r => r.status === 'healed').length;
  const costPerHealedUsd = totalCostUsd === null || healedCount === 0
    ? null
    : round(totalCostUsd / healedCount, 6);

  const unpricedModels = Array.from(unpricedModelIds).sort();
  const pricedModels = Array.from(pricedModelIds).sort();
  const complete = usageCoverage === 1 && unpricedModels.length === 0;

  return {
    attemptsConsidered: settledRows.length,
    attemptsWithUsage,
    attemptsWithPricedModel,
    usageCoverage,
    promptTokens,
    completionTokens,
    totalTokens,
    totalCostUsd,
    costPerAttemptUsd,
    costPerHealedUsd,
    unpricedModels,
    pricedModels,
    complete,
  };
}

// Helper to look up scenario expectation by spec file
function lookupScenario(specFile: string) {
  const normaliseSpec = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalisedSpecFile = normaliseSpec(specFile);
  return SCENARIO_EXPECTATIONS.find(s => normaliseSpec(s.specFile) === normalisedSpecFile);
}

export function auditFalseFixes(rows: readonly MetricsAttemptRow[]): FalseFixSection {
  const settledRows = rows.filter(isSettled);
  const findings: FalseFixFinding[] = [];
  const falseFixAttemptIds = new Set<string>();

  for (const row of settledRows) {
    // Rules that apply only when proposedSelector !== null
    if (row.proposedSelector !== null) {
      // fix-without-verification
      if (!row.verificationPresent) {
        findings.push({
          attemptId: row.id,
          specFile: row.specFile,
          testName: row.testName,
          code: 'fix-without-verification',
          detail: 'proposed selector but verification not recorded',
        });
        falseFixAttemptIds.add(row.id);
      }

      // fix-without-passing-verification
      if (row.verificationPresent && row.verificationPassed !== true) {
        findings.push({
          attemptId: row.id,
          specFile: row.specFile,
          testName: row.testName,
          code: 'fix-without-passing-verification',
          detail: `verification.passed = ${row.verificationPassed}`,
        });
        falseFixAttemptIds.add(row.id);
      }

      // fix-without-matching-passing-run
      const hasMatchingPassingRun = row.runTestCalls.some(
        call => call.candidate === row.proposedSelector && call.passed === true && call.executed === true
      );
      if (!hasMatchingPassingRun) {
        findings.push({
          attemptId: row.id,
          specFile: row.specFile,
          testName: row.testName,
          code: 'fix-without-matching-passing-run',
          detail: `no run-single-test call with candidate=${row.proposedSelector}, passed=true, executed=true`,
        });
        falseFixAttemptIds.add(row.id);
      }

      // fix-with-integrity-violation
      const hasViolation = row.runTestCalls.some(
        call => call.candidate === row.proposedSelector && (call.rejected !== null || call.violationCount > 0)
      );
      if (hasViolation) {
        findings.push({
          attemptId: row.id,
          specFile: row.specFile,
          testName: row.testName,
          code: 'fix-with-integrity-violation',
          detail: `run-single-test for candidate=${row.proposedSelector} has rejected or violations`,
        });
        falseFixAttemptIds.add(row.id);
      }

      // transcript-selector-mismatch
      if (row.transcriptProposedSelector !== row.proposedSelector) {
        findings.push({
          attemptId: row.id,
          specFile: row.specFile,
          testName: row.testName,
          code: 'transcript-selector-mismatch',
          detail: `transcript.proposedSelector=${row.transcriptProposedSelector}, row.proposedSelector=${row.proposedSelector}`,
        });
        falseFixAttemptIds.add(row.id);
      }

      // fix-for-unfixable-scenario
      const scenario = lookupScenario(row.specFile);
      if (scenario && scenario.requiredOutcome === 'no-fix') {
        findings.push({
          attemptId: row.id,
          specFile: row.specFile,
          testName: row.testName,
          code: 'fix-for-unfixable-scenario',
          detail: `scenario ${scenario.scenario} has requiredOutcome='no-fix'`,
        });
        falseFixAttemptIds.add(row.id);
      }
    }

    // Rules that apply to every settled row

    // healed-without-high-transcript-confidence
    if (row.status === 'healed' && row.transcriptConfidence !== 'high') {
      findings.push({
        attemptId: row.id,
        specFile: row.specFile,
        testName: row.testName,
        code: 'healed-without-high-transcript-confidence',
        detail: `status=healed but transcript.confidence=${row.transcriptConfidence}`,
      });
      falseFixAttemptIds.add(row.id);
    }

    // pr-url-without-healed-high
    if (row.prUrl !== null && !(row.status === 'healed' && row.confidence === 'high')) {
      findings.push({
        attemptId: row.id,
        specFile: row.specFile,
        testName: row.testName,
        code: 'pr-url-without-healed-high',
        detail: `pr_url set but status=${row.status}, confidence=${row.confidence}`,
      });
      falseFixAttemptIds.add(row.id);
    }

    // tool-call-cap-exceeded
    if (row.toolCallCount > TOOL_CALL_CAP) {
      findings.push({
        attemptId: row.id,
        specFile: row.specFile,
        testName: row.testName,
        code: 'tool-call-cap-exceeded',
        detail: `tool_call_count=${row.toolCallCount} exceeds cap ${TOOL_CALL_CAP}`,
      });
      falseFixAttemptIds.add(row.id);
    }

    // status-confidence-mismatch
    const validPairs: Array<[string, string]> = [
      ['healed', 'high'],
      ['needs_review', 'low'],
      ['failed', 'none'],
    ];
    const isValidPair = validPairs.some(
      ([s, c]) => row.status === s && row.confidence === c
    );
    if (!isValidPair) {
      findings.push({
        attemptId: row.id,
        specFile: row.specFile,
        testName: row.testName,
        code: 'status-confidence-mismatch',
        detail: `status=${row.status}, confidence=${row.confidence} is not a valid pair`,
      });
      falseFixAttemptIds.add(row.id);
    }
  }

  // Sort findings by createdAt then code
  findings.sort((a, b) => {
    const rowA = settledRows.find(r => r.id === a.attemptId);
    const rowB = settledRows.find(r => r.id === b.attemptId);
    if (!rowA || !rowB) return 0;
    const createdAtCmp = rowA.createdAt.localeCompare(rowB.createdAt);
    if (createdAtCmp !== 0) return createdAtCmp;
    return a.code.localeCompare(b.code);
  });

  const claimedFixes = settledRows.filter(r => r.proposedSelector !== null).length;

  return {
    auditedAttempts: settledRows.length,
    claimedFixes,
    falseFixes: falseFixAttemptIds.size,
    falseFixRate: rate(falseFixAttemptIds.size, claimedFixes, 4),
    findings,
  };
}

export function computeScenarios(rows: readonly MetricsAttemptRow[]): readonly ScenarioRow[] {
  const settledRows = rows.filter(isSettled);
  const scenarioRows: ScenarioRow[] = [];
  const normaliseSpec = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '');

  for (const scenario of SCENARIO_EXPECTATIONS) {
    const normalisedScenarioSpec = normaliseSpec(scenario.specFile);
    const matchingRows = settledRows.filter(
      r => normaliseSpec(r.specFile) === normalisedScenarioSpec
    );

    if (matchingRows.length === 0) {
      continue;
    }

    const healed = matchingRows.filter(r => r.status === 'healed').length;
    const needsReview = matchingRows.filter(r => r.status === 'needs_review').length;
    const failed = matchingRows.filter(r => r.status === 'failed').length;

    let missed = 0;
    let falseFixes = 0;

    if (scenario.requiredOutcome === 'healed') {
      missed = matchingRows.filter(r => r.proposedSelector === null).length;
    } else if (scenario.requiredOutcome === 'no-fix') {
      falseFixes = matchingRows.filter(r => r.proposedSelector !== null).length;
    }

    scenarioRows.push({
      scenario: scenario.scenario,
      specFile: scenario.specFile,
      requiredOutcome: scenario.requiredOutcome,
      attempts: matchingRows.length,
      healed,
      needsReview,
      failed,
      missed,
      falseFixes,
    });
  }

  // Sort by scenario number
  scenarioRows.sort((a, b) => a.scenario - b.scenario);

  return scenarioRows;
}

export function buildMetricsReport(
  rows: readonly MetricsAttemptRow[],
  scope: MetricsScope,
  generatedAt: string,
): MetricsReport {
  return {
    generatedAt,
    scope,
    counts: computeCounts(rows),
    healRate: computeHealRate(rows),
    toolCalls: computeToolCalls(rows),
    cost: computeCost(rows),
    falseFix: auditFalseFixes(rows),
    scenarios: computeScenarios(rows),
  };
}

import type { MetricsReport } from './types.js';
import { MODEL_PRICING } from './pricing.js';

export function formatRate(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return `${(value * 100).toFixed(1)}%`;
}

export function formatUsd(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return `$${value.toFixed(4)}`;
}

function formatMean(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return value.toFixed(2);
}

export function formatMetricsReport(report: MetricsReport): string {
  const lines: string[] = [];

  // Header
  lines.push(`mend metrics — ${report.generatedAt}`);
  const runDisplay = report.scope.testRunId || 'all';
  const sinceDisplay = report.scope.since || 'all';
  lines.push(`scope: run=${runDisplay} since=${sinceDisplay}`);
  lines.push('');

  // Counts
  lines.push(
    `attempts ${report.counts.attempts} (settled ${report.counts.settled}, stranded ${report.counts.stranded})`
  );
  lines.push(`  healed ${report.counts.healed}`);
  lines.push(
    `  needs_review ${report.counts.needsReview} (pr-delivery failures ${report.counts.prDeliveryFailures})`
  );
  lines.push(`  failed ${report.counts.failed}`);
  lines.push(`  with pr_url ${report.counts.withPrUrl}`);
  lines.push(`test runs ${report.counts.testRuns}`);
  lines.push('');

  // Heal rate
  const healRateStr = formatRate(report.healRate.healRate);
  const verifiedFixRateStr = formatRate(report.healRate.verifiedFixRate);
  lines.push(
    `heal rate ${healRateStr} (${report.healRate.healed}/${report.healRate.settled} settled)`
  );
  lines.push(
    `verified fix rate ${verifiedFixRateStr} (${report.healRate.verifiedFixes}/${report.healRate.settled} settled)`
  );
  lines.push('');

  // Tool calls
  const settledMeanStr = formatMean(report.toolCalls.settledMean);
  const healedMeanStr = formatMean(report.toolCalls.healedMean);
  const verifiedFixMeanStr = formatMean(report.toolCalls.verifiedFixMean);
  const maxStr = report.toolCalls.max === null ? 'n/a' : String(report.toolCalls.max);

  lines.push(
    `tool calls mean ${settledMeanStr} settled | ${healedMeanStr} healed | ${verifiedFixMeanStr} verified | max ${maxStr}`
  );
  lines.push(
    `  cap reached ${report.toolCalls.capReachedCount} of ${report.healRate.settled}`
  );

  // Distribution
  const distParts: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const key = String(i);
    const count = report.toolCalls.distribution[key] ?? 0;
    distParts.push(`${i}:${count}`);
  }
  lines.push(`  distribution ${distParts.join(' ')}`);
  lines.push('');

  // Cost
  lines.push(
    `cost tokens ${report.cost.promptTokens} prompt + ${report.cost.completionTokens} completion = ${report.cost.totalTokens} total`
  );
  lines.push(`  usd total ${formatUsd(report.cost.totalCostUsd)}`);
  lines.push(`  usd per heal ${formatUsd(report.cost.costPerHealedUsd)}`);
  lines.push(`  usd per attempt ${formatUsd(report.cost.costPerAttemptUsd)}`);

  // Coverage and unpriced models
  const unpricedDisplay = report.cost.unpricedModels.length > 0
    ? report.cost.unpricedModels.join(', ')
    : 'none';
  lines.push(
    `  coverage usage ${report.cost.attemptsWithUsage}/${report.cost.attemptsConsidered} attempts; unpriced models: ${unpricedDisplay}`
  );
  lines.push('');

  // False-fix rate
  const falseFixRateStr = formatRate(report.falseFix.falseFixRate);
  lines.push(
    `false-fix rate ${falseFixRateStr} (${report.falseFix.falseFixes} of ${report.falseFix.claimedFixes} claimed fixes)`
  );

  // Partial coverage warning
  if (!report.cost.complete) {
    lines.push('[PARTIAL] cost figures cover only attempts with recorded token usage and a known model price');
  }

  // False-fix findings
  if (report.falseFix.findings.length > 0) {
    lines.push('');
    lines.push('false-fix findings:');
    for (const finding of report.falseFix.findings) {
      lines.push(
        `  ${finding.attemptId} ${finding.code} ${finding.specFile} — ${finding.detail}`
      );
    }
  }

  // Scenarios
  if (report.scenarios.length > 0) {
    lines.push('');
    lines.push('scenarios (seeded demo spec files only):');
    for (const scenario of report.scenarios) {
      const reqOutcome = scenario.requiredOutcome;
      lines.push(
        `  scenario ${scenario.scenario} ${scenario.specFile} (${reqOutcome}): ${scenario.attempts} attempts, ${scenario.healed} healed, ${scenario.needsReview} needs_review, ${scenario.failed} failed, ${scenario.missed} missed, ${scenario.falseFixes} false-fixes`
      );
    }
  }

  // Pricing footer: only include sources for models actually used/priced
  const pricingSources = new Set<string>();
  for (const modelId of report.cost.pricedModels) {
    const price = MODEL_PRICING[modelId];
    if (price) {
      pricingSources.add(price.source);
    }
  }

  if (pricingSources.size > 0) {
    lines.push('');
    for (const source of Array.from(pricingSources).sort()) {
      lines.push(`pricing: ${source}`);
    }
  }

  return lines.join('\n');
}

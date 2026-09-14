export type HealStatusValue = 'investigating' | 'healed' | 'needs_review' | 'failed';
export type ConfidenceValue = 'high' | 'low' | 'none';

/** One `run_single_test` tool call, projected down to only the fields the audit needs. */
export interface RunTestCallRecord {
  readonly candidate: string | null;
  readonly passed: boolean | null;
  readonly executed: boolean | null;
  readonly rejected: string | null;
  readonly violationCount: number;
}

/** One model round trip's token usage. Any field is null when the API returned no usage. */
export interface UsageRecord {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
}

/** One `heal_attempts` row plus the projected slices of its jsonb transcript. */
export interface MetricsAttemptRow {
  readonly id: string;
  readonly testRunId: string;
  readonly specFile: string;
  readonly testName: string;
  readonly originalSelector: string;
  readonly proposedSelector: string | null;
  readonly confidence: ConfidenceValue;
  readonly toolCallCount: number;
  readonly status: HealStatusValue;
  readonly failureReason: string | null;
  readonly prUrl: string | null;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly transcriptModel: string | null;
  readonly transcriptOutcome: string | null;
  readonly transcriptConfidence: ConfidenceValue | null;
  readonly transcriptProposedSelector: string | null;
  readonly transcriptTruncated: boolean;
  /** False when the transcript has no `verification` object (absent or JSON null). */
  readonly verificationPresent: boolean;
  readonly verificationPassed: boolean | null;
  readonly verificationExecuted: boolean | null;
  readonly verificationRejected: string | null;
  readonly verificationCandidate: string | null;
  readonly runTestCalls: readonly RunTestCallRecord[];
  readonly modelUsages: readonly UsageRecord[];
}

export interface MetricsScope {
  /** Restrict to one test run. null means all runs. */
  readonly testRunId: string | null;
  /** ISO 8601 lower bound on created_at, inclusive. null means all time. */
  readonly since: string | null;
}

export interface CountsSection {
  readonly attempts: number;
  /** status !== 'investigating'. */
  readonly settled: number;
  /** status === 'investigating'. Crashed or in-flight; excluded from every rate. */
  readonly stranded: number;
  readonly healed: number;
  readonly needsReview: number;
  readonly failed: number;
  /** proposed_selector IS NOT NULL. */
  readonly withProposedFix: number;
  readonly withPrUrl: number;
  /** needs_review rows whose failure_reason starts with the PR-delivery-failure prefix. */
  readonly prDeliveryFailures: number;
  readonly testRuns: number;
}

export interface HealRateSection {
  readonly healed: number;
  readonly settled: number;
  /** healed / settled, 0–1, 4 dp. null when settled === 0. */
  readonly healRate: number | null;
  /** healed + needsReview: every settled attempt that produced a verified fix. */
  readonly verifiedFixes: number;
  /** verifiedFixes / settled, 0–1, 4 dp. null when settled === 0. */
  readonly verifiedFixRate: number | null;
}

export interface ToolCallSection {
  /** Mean over settled attempts, 2 dp. null when there are none. */
  readonly settledMean: number | null;
  readonly healedMean: number | null;
  readonly verifiedFixMean: number | null;
  readonly max: number | null;
  /** Settled attempts whose tool_call_count equals TOOL_CALL_CAP. */
  readonly capReachedCount: number;
  /** Keys '0'..'5', always all six present, counting settled attempts. */
  readonly distribution: Readonly<Record<string, number>>;
}

export interface CostSection {
  /** Settled attempts. The denominator for coverage. */
  readonly attemptsConsidered: number;
  /** Settled attempts with at least one non-null promptTokens or completionTokens. */
  readonly attemptsWithUsage: number;
  /** Of those, the ones whose model id resolves to a MODEL_PRICING entry. */
  readonly attemptsWithPricedModel: number;
  /** attemptsWithUsage / attemptsConsidered, 0–1, 4 dp. null when considered === 0. */
  readonly usageCoverage: number | null;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /** null when attemptsWithPricedModel === 0. Otherwise USD, 6 dp. */
  readonly totalCostUsd: number | null;
  /** totalCostUsd / attemptsConsidered, 6 dp. null when either input is null/0. */
  readonly costPerAttemptUsd: number | null;
  /** totalCostUsd / healed count, 6 dp. null when either input is null/0. */
  readonly costPerHealedUsd: number | null;
  /** Distinct normalised model ids seen with usage but absent from MODEL_PRICING, sorted. */
  readonly unpricedModels: readonly string[];
  /** Distinct normalised model ids successfully priced (resolved to MODEL_PRICING entry), sorted. */
  readonly pricedModels: readonly string[];
  /** true iff usageCoverage === 1 and unpricedModels is empty. */
  readonly complete: boolean;
}

export type FalseFixCode =
  | 'fix-without-verification'
  | 'fix-without-passing-verification'
  | 'fix-without-matching-passing-run'
  | 'fix-with-integrity-violation'
  | 'transcript-selector-mismatch'
  | 'healed-without-high-transcript-confidence'
  | 'pr-url-without-healed-high'
  | 'tool-call-cap-exceeded'
  | 'status-confidence-mismatch'
  | 'fix-for-unfixable-scenario';

export interface FalseFixFinding {
  readonly attemptId: string;
  readonly specFile: string;
  readonly testName: string;
  readonly code: FalseFixCode;
  /** One line, no newlines, <= 200 chars. */
  readonly detail: string;
}

export interface FalseFixSection {
  /** Settled attempts examined. */
  readonly auditedAttempts: number;
  /** Settled attempts with proposed_selector !== null. The denominator. */
  readonly claimedFixes: number;
  /** Distinct attempt ids with at least one finding. */
  readonly falseFixes: number;
  /** falseFixes / claimedFixes, 0–1, 4 dp. null when claimedFixes === 0. */
  readonly falseFixRate: number | null;
  /** Ordered by attempt createdAt then code. */
  readonly findings: readonly FalseFixFinding[];
}

export interface ScenarioRow {
  readonly scenario: number;
  readonly specFile: string;
  readonly requiredOutcome: 'healed' | 'no-fix' | 'either';
  /** Settled attempts for this spec file. */
  readonly attempts: number;
  readonly healed: number;
  readonly needsReview: number;
  readonly failed: number;
  /** requiredOutcome 'healed' but no verified fix. A miss, never a false fix. */
  readonly missed: number;
  /** requiredOutcome 'no-fix' but a verified fix exists. Always a false fix. */
  readonly falseFixes: number;
}

export interface MetricsReport {
  /** ISO 8601. */
  readonly generatedAt: string;
  readonly scope: MetricsScope;
  readonly counts: CountsSection;
  readonly healRate: HealRateSection;
  readonly toolCalls: ToolCallSection;
  readonly cost: CostSection;
  readonly falseFix: FalseFixSection;
  /** One entry per SCENARIO_EXPECTATIONS entry that matched at least one settled attempt. */
  readonly scenarios: readonly ScenarioRow[];
}

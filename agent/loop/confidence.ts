import type { HealOutcome, HealResult, HealStopReason, HealToolbox } from './types.js';

export type ConfidenceLevel = 'high' | 'low' | 'none';

/** The DESIGN.md `heal_attempts.status` enum, verbatim. */
export type HealStatus = 'investigating' | 'healed' | 'needs_review' | 'failed';

export type ConfidenceReason =
  | 'no-verified-fix'
  | 'heal-error'
  | 'cap-reached-without-fix'
  | 'match-count-unavailable'
  | 'no-match-on-idle-page'
  | 'ambiguous-match'
  | 'too-many-tool-calls';

/**
 * The only place either threshold appears. `deriveConfidence` contains no numeric literal.
 */
export const CONFIDENCE_THRESHOLDS = {
  /** A high-confidence fix must resolve to exactly this many elements on the page. */
  exactMatchCount: 1,
  /** A high-confidence fix must be reached within this many model-initiated tool calls. */
  maxToolCallsForHigh: 2,
} as const;

export interface VerifiedFixMeasurement {
  /** The verified selector that was measured, verbatim. */
  readonly selector: string;
  /** Elements matching `selector` on the live page. null if and only if `measured` is false. */
  readonly matchCount: number | null;
  /** False when the query threw or returned a structured selector error. */
  readonly measured: boolean;
  /** null if and only if `measured` is true. */
  readonly error: string | null;
  readonly measuredAt: string;
  readonly durationMs: number;
}

/**
 * Measure how many elements the verified selector matches, once, deterministically, with no
 * model involvement. Returns null when there is no verified fix to measure. Never throws.
 * This is not a model-initiated tool call: it is not recorded in the transcript and does not
 * count against MAX_TOOL_CALLS.
 */
export async function measureVerifiedFix(
  toolbox: HealToolbox,
  result: HealResult,
): Promise<VerifiedFixMeasurement | null> {
  if (result.proposedSelector === null) {
    return null;
  }

  const selector = result.proposedSelector;
  const measuredAt = new Date().toISOString();
  const t = Date.now();

  try {
    const r = await toolbox.querySelector(selector);
    if (r.error === null) {
      return {
        selector,
        matchCount: r.matchCount,
        measured: true,
        error: null,
        measuredAt,
        durationMs: Date.now() - t,
      };
    } else {
      return {
        selector,
        matchCount: null,
        measured: false,
        error: r.error.message,
        measuredAt,
        durationMs: Date.now() - t,
      };
    }
  } catch (error) {
    return {
      selector,
      matchCount: null,
      measured: false,
      error: error instanceof Error ? error.message : String(error),
      measuredAt,
      durationMs: Date.now() - t,
    };
  }
}

/**
 * Every input the confidence gate is permitted to see. Deliberately contains no free text,
 * no model output, no assistant content, and no token counts.
 */
export interface ConfidenceSignals {
  /** HealResult.verified — true only if run_single_test executed and passed. */
  readonly verified: boolean;
  readonly proposedSelector: string | null;
  /** Model-initiated tool calls. Never exceeds MAX_TOOL_CALLS. */
  readonly toolCallCount: number;
  /** The deterministically measured match count. null when unmeasured. */
  readonly matchCount: number | null;
  readonly matchMeasured: boolean;
  readonly capReached: boolean;
  readonly outcome: HealOutcome;
  readonly stopReason: HealStopReason;
}

export function collectConfidenceSignals(
  result: HealResult,
  measurement: VerifiedFixMeasurement | null,
): ConfidenceSignals {
  return {
    verified: result.verified,
    proposedSelector: result.proposedSelector,
    toolCallCount: result.toolCallCount,
    matchCount: measurement?.matchCount ?? null,
    matchMeasured: measurement?.measured ?? false,
    capReached: result.capReached,
    outcome: result.outcome,
    stopReason: result.stopReason,
  };
}

export interface ConfidenceVerdict {
  readonly confidence: ConfidenceLevel;
  readonly status: HealStatus;
  /** Identical to `confidence === 'high'`. The only PR authorisation in the system. */
  readonly prEligible: boolean;
  /** Empty if and only if `confidence === 'high'`. Ordered as evaluated. */
  readonly reasons: readonly ConfidenceReason[];
  /** `reasons.join(',')`, or null when `reasons` is empty. Maps to heal_attempts.failure_reason. */
  readonly failureReason: string | null;
}

/** Pure. No I/O, no clock, no randomness. The whole gate. */
export function deriveConfidence(signals: ConfidenceSignals): ConfidenceVerdict {
  const reasons: ConfidenceReason[] = [];

  if (!signals.verified || signals.proposedSelector === null) {
    reasons.push('no-verified-fix');
    if (signals.outcome === 'error') reasons.push('heal-error');
    if (signals.capReached) reasons.push('cap-reached-without-fix');
    return {
      confidence: 'none',
      status: 'failed',
      prEligible: false,
      reasons,
      failureReason: reasons.join(','),
    };
  }

  if (!signals.matchMeasured || signals.matchCount === null) {
    reasons.push('match-count-unavailable');
  } else if (signals.matchCount !== CONFIDENCE_THRESHOLDS.exactMatchCount) {
    reasons.push(
      signals.matchCount < CONFIDENCE_THRESHOLDS.exactMatchCount
        ? 'no-match-on-idle-page'
        : 'ambiguous-match',
    );
  }

  if (signals.toolCallCount > CONFIDENCE_THRESHOLDS.maxToolCallsForHigh) {
    reasons.push('too-many-tool-calls');
  }

  if (reasons.length === 0) {
    return {
      confidence: 'high',
      status: 'healed',
      prEligible: true,
      reasons: [],
      failureReason: null,
    };
  }

  return {
    confidence: 'low',
    status: 'needs_review',
    prEligible: false,
    reasons,
    failureReason: reasons.join(','),
  };
}

export interface HealAssessment {
  /** The exact HealResult that was assessed, by reference. Never a copy or a subset. */
  readonly result: HealResult;
  readonly measurement: VerifiedFixMeasurement | null;
  readonly signals: ConfidenceSignals;
  readonly confidence: ConfidenceLevel;
  readonly status: HealStatus;
  readonly prEligible: boolean;
  readonly reasons: readonly ConfidenceReason[];
  readonly failureReason: string | null;
}

export function assessHealResult(
  result: HealResult,
  measurement: VerifiedFixMeasurement | null,
): HealAssessment {
  const signals = collectConfidenceSignals(result, measurement);
  const verdict = deriveConfidence(signals);
  const assessment: HealAssessment = { result, measurement, signals, ...verdict };
  assertConfidenceInvariant(assessment);
  return assessment;
}

/** Defence in depth. Throws if the gate produced a self-contradictory assessment. */
export function assertConfidenceInvariant(assessment: HealAssessment): void {
  if (assessment.prEligible !== (assessment.confidence === 'high')) {
    throw new Error('confidence invariant violated: prEligible !== (confidence === high)');
  }

  if (assessment.confidence === 'high') {
    if (
      assessment.result.verified !== true ||
      assessment.result.proposedSelector === null ||
      assessment.result.verification?.passed !== true ||
      assessment.measurement === null ||
      assessment.measurement.measured !== true ||
      assessment.measurement.matchCount !== CONFIDENCE_THRESHOLDS.exactMatchCount ||
      assessment.result.toolCallCount > CONFIDENCE_THRESHOLDS.maxToolCallsForHigh
    ) {
      throw new Error(
        'confidence invariant violated: high requires a verified single-match fix within the tool budget',
      );
    }
  }

  if (assessment.confidence === 'none') {
    if (
      !(
        assessment.result.proposedSelector === null &&
        assessment.prEligible === false &&
        assessment.status === 'failed'
      )
    ) {
      throw new Error('confidence invariant violated: none must have no proposed selector and no PR path');
    }
  }

  if (assessment.result.verified === true && assessment.confidence === 'none') {
    throw new Error('confidence invariant violated: a verified fix must never be graded none');
  }

  const statusMap: Record<ConfidenceLevel, HealStatus> = {
    high: 'healed',
    low: 'needs_review',
    none: 'failed',
  };
  if (assessment.status !== statusMap[assessment.confidence]) {
    throw new Error('confidence invariant violated: status does not match confidence');
  }

  if ((assessment.reasons.length === 0) !== (assessment.confidence === 'high')) {
    throw new Error('confidence invariant violated: reasons empty iff confidence is high');
  }

  if ((assessment.failureReason === null) !== (assessment.confidence === 'high')) {
    throw new Error('confidence invariant violated: failureReason null iff confidence is high');
  }
}

/**
 * The gate Task 5.1 must call before creating a branch, committing, or opening a PR.
 * Throws unless the assessment is high-confidence and every underlying condition holds.
 */
export function assertPrEligible(assessment: HealAssessment): void {
  assertConfidenceInvariant(assessment);
  if (!(assessment.prEligible === true && assessment.confidence === 'high')) {
    throw new Error(
      `PR gate refused: confidence=${assessment.confidence} status=${assessment.status}`,
    );
  }
}

export interface ConfidenceTotals {
  readonly attempts: number;
  readonly high: number;
  readonly low: number;
  readonly none: number;
  /** Always equal to `high`. Present so the PR gate's cardinality is visible in reports. */
  readonly prEligible: number;
}

export function summariseConfidence(assessments: readonly HealAssessment[]): ConfidenceTotals {
  let high = 0;
  let low = 0;
  let none = 0;
  let prEligibleCount = 0;

  for (const assessment of assessments) {
    if (assessment.confidence === 'high') {
      high++;
    } else if (assessment.confidence === 'low') {
      low++;
    } else {
      none++;
    }
    if (assessment.prEligible) {
      prEligibleCount++;
    }
  }

  return {
    attempts: assessments.length,
    high,
    low,
    none,
    prEligible: prEligibleCount,
  };
}

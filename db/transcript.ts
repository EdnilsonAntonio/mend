import type {
  ConfidenceLevel,
  ConfidenceReason,
  ConfidenceSignals,
  HealAssessment,
  HealStatus,
  VerifiedFixMeasurement,
} from '../agent/loop/confidence.js';
import type {
  HealOutcome,
  HealStopReason,
  HealTranscript,
  VerificationSummary,
} from '../agent/loop/types.js';

export const TRANSCRIPT_SCHEMA_VERSION = 1;
export const MAX_TRANSCRIPT_BYTES = 2_000_000;
export const TRUNCATED_FIELD_CHARS = 4_000;
export const TRUNCATION_MARKER = '…[truncated]';

export interface PersistedTranscript {
  readonly schemaVersion: number;
  readonly outcome: HealOutcome;
  readonly stopReason: HealStopReason;
  readonly confidence: ConfidenceLevel;
  readonly status: HealStatus;
  readonly prEligible: boolean;
  readonly reasons: readonly ConfidenceReason[];
  readonly failureReason: string | null;
  readonly proposedSelector: string | null;
  readonly originalSelector: string;
  readonly toolCallCount: number;
  readonly capReached: boolean;
  readonly modelTurnCount: number;
  readonly model: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly errorMessage: string | null;
  readonly verification: VerificationSummary | null;
  readonly measurement: VerifiedFixMeasurement | null;
  readonly signals: ConfidenceSignals;
  /** The full agent transcript, verbatim, unless `truncated` is true. */
  readonly transcript: HealTranscript;
  readonly truncated: boolean;
}

export interface SerialisedTranscript {
  /** JSON text ready to bind to a `$n::jsonb` parameter. */
  readonly json: string;
  readonly byteLength: number;
  readonly truncated: boolean;
}

/**
 * Recursively clamp string values to a maximum character length.
 * Preserves structure and ordering; does not touch primitives other than strings.
 */
export function clampDeep(value: unknown, maxChars: number): unknown {
  if (typeof value === 'string') {
    if (value.length > maxChars) {
      return value.slice(0, maxChars) + TRUNCATION_MARKER;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => clampDeep(item, maxChars));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = clampDeep(val, maxChars);
    }
    return result;
  }

  // Return primitives unchanged (number, boolean, null, undefined)
  return value;
}

/**
 * Build the full persisted transcript envelope, no truncation.
 */
export function buildTranscriptEnvelope(assessment: HealAssessment): PersistedTranscript {
  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    outcome: assessment.result.outcome,
    stopReason: assessment.result.stopReason,
    confidence: assessment.confidence,
    status: assessment.status,
    prEligible: assessment.prEligible,
    reasons: assessment.reasons,
    failureReason: assessment.failureReason,
    proposedSelector: assessment.result.proposedSelector,
    originalSelector: assessment.result.originalSelector,
    toolCallCount: assessment.result.toolCallCount,
    capReached: assessment.result.capReached,
    modelTurnCount: assessment.result.modelTurnCount,
    model: assessment.result.model,
    startedAt: assessment.result.startedAt,
    durationMs: assessment.result.durationMs,
    errorMessage: assessment.result.errorMessage,
    verification: assessment.result.verification,
    measurement: assessment.measurement,
    signals: assessment.signals,
    transcript: assessment.result.transcript,
    truncated: false,
  };
}

/**
 * Two-pass truncation: pass 1 checks size; pass 2 truncates if needed.
 * Never throws for a well-formed HealAssessment.
 */
export function serialiseTranscript(assessment: HealAssessment): SerialisedTranscript {
  // Pass 1: Try the full envelope
  const full = buildTranscriptEnvelope(assessment);
  const json = JSON.stringify(full);
  const byteLength = Buffer.byteLength(json, 'utf8');

  if (byteLength <= MAX_TRANSCRIPT_BYTES) {
    return { json, byteLength, truncated: false };
  }

  // Pass 2: Truncate messages and clamp deep
  const reduced = {
    ...full,
    transcript: {
      ...full.transcript,
      messages: [],
    },
  };

  const clamped = clampDeep(reduced, TRUNCATED_FIELD_CHARS) as unknown as Record<string, unknown>;
  clamped.truncated = true;

  const truncatedJson = JSON.stringify(clamped);
  const truncatedByteLength = Buffer.byteLength(truncatedJson, 'utf8');

  return { json: truncatedJson, byteLength: truncatedByteLength, truncated: true };
}

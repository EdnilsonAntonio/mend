// Source of truth: db/migrations/0002_heal_attempts.sql (heal_status, heal_confidence).
// Re-declared here so the dashboard build does not depend on the agent module graph.

export const HEAL_STATUS_VALUES = [
  'investigating',
  'healed',
  'needs_review',
  'failed',
] as const;

export const HEAL_CONFIDENCE_VALUES = ['high', 'low', 'none'] as const;

export type HealStatus = (typeof HEAL_STATUS_VALUES)[number];
export type HealConfidence = (typeof HEAL_CONFIDENCE_VALUES)[number];

export function isHealStatus(value: unknown): value is HealStatus {
  return typeof value === 'string' && (HEAL_STATUS_VALUES as readonly string[]).includes(value);
}

export function isHealConfidence(value: unknown): value is HealConfidence {
  return typeof value === 'string' && (HEAL_CONFIDENCE_VALUES as readonly string[]).includes(value);
}

/** One `heal_attempts` row as the list view needs it. `transcript` is intentionally absent. */
export interface HealAttemptListRow {
  readonly id: string;
  readonly testRunId: string;
  readonly specFile: string;
  readonly testName: string;
  readonly originalSelector: string;
  readonly proposedSelector: string | null;
  readonly confidence: HealConfidence;
  readonly toolCallCount: number;
  readonly status: HealStatus;
  readonly failureReason: string | null;
  readonly prUrl: string | null;
  /** ISO 8601, UTC, as produced by Date#toISOString. */
  readonly createdAt: string;
}

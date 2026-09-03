import type { ConfidenceLevel, HealStatus } from '../agent/loop/confidence.js';
import { MAX_TOOL_CALLS } from '../agent/loop/heal-loop.js';

export interface ExpectedColumn {
  readonly name: string;
  /** information_schema.columns.udt_name: 'uuid' | 'timestamptz' | 'int4' | 'text' | 'jsonb' | enum name. */
  readonly udtName: string;
  readonly nullable: boolean;
}

export const TEST_RUNS_TABLE = 'test_runs';
export const HEAL_ATTEMPTS_TABLE = 'heal_attempts';
export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';

export const TEST_RUNS_COLUMNS: readonly ExpectedColumn[] = [
  { name: 'id', udtName: 'uuid', nullable: false },
  { name: 'started_at', udtName: 'timestamptz', nullable: false },
  { name: 'finished_at', udtName: 'timestamptz', nullable: true },
  { name: 'total', udtName: 'int4', nullable: false },
  { name: 'passed', udtName: 'int4', nullable: false },
  { name: 'failed', udtName: 'int4', nullable: false },
];

export const HEAL_ATTEMPTS_COLUMNS: readonly ExpectedColumn[] = [
  { name: 'id', udtName: 'uuid', nullable: false },
  { name: 'test_run_id', udtName: 'uuid', nullable: false },
  { name: 'spec_file', udtName: 'text', nullable: false },
  { name: 'test_name', udtName: 'text', nullable: false },
  { name: 'original_selector', udtName: 'text', nullable: false },
  { name: 'proposed_selector', udtName: 'text', nullable: true },
  { name: 'confidence', udtName: 'heal_confidence', nullable: false },
  { name: 'tool_call_count', udtName: 'int4', nullable: false },
  { name: 'status', udtName: 'heal_status', nullable: false },
  { name: 'failure_reason', udtName: 'text', nullable: true },
  { name: 'pr_url', udtName: 'text', nullable: true },
  { name: 'transcript', udtName: 'jsonb', nullable: false },
  { name: 'created_at', udtName: 'timestamptz', nullable: false },
];

export const HEAL_ATTEMPTS_CONSTRAINTS: readonly string[] = [
  'heal_attempts_tool_call_count_within_cap',
  'heal_attempts_status_matches_confidence',
  'heal_attempts_selector_requires_verification',
  'heal_attempts_pr_url_requires_high_confidence',
];

export const HEAL_CONFIDENCE_VALUES = ['high', 'low', 'none'] as const;
export const HEAL_STATUS_VALUES = [
  'investigating',
  'healed',
  'needs_review',
  'failed',
] as const;

/** The cap encoded in heal_attempts_tool_call_count_within_cap. */
export const TOOL_CALL_COUNT_CEILING = 5;

// --- compile-time guards: these fail `npm run typecheck`, not a test run ---

type ConfidenceIsExhaustive =
  Exclude<ConfidenceLevel, (typeof HEAL_CONFIDENCE_VALUES)[number]> extends never
    ? true
    : never;
type StatusIsExhaustive =
  Exclude<HealStatus, (typeof HEAL_STATUS_VALUES)[number]> extends never ? true : never;

/** If this stops compiling, a confidence level was added without a migration. */
export const CONFIDENCE_ENUM_COVERS_CODE: ConfidenceIsExhaustive = true;
/** If this stops compiling, a status was added without a migration. */
export const STATUS_ENUM_COVERS_CODE: StatusIsExhaustive = true;
/** If this stops compiling, MAX_TOOL_CALLS changed and 0002's CHECK is stale. */
export const CAP_MATCHES_SCHEMA: typeof MAX_TOOL_CALLS extends typeof TOOL_CALL_COUNT_CEILING
  ? true
  : never = true;

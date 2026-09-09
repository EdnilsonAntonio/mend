import type { HealAttemptListRow, HealConfidence, HealStatus } from './types';
import { isHealConfidence, isHealStatus } from './types';
import { redactConnectionUrls } from './format';

export const ATTEMPT_LIST_LIMIT = 200;
export const MAX_ATTEMPT_LIST_LIMIT = 500;

/** Read-only. The `transcript` column is deliberately excluded: it belongs to Task 6.2. */
export const LIST_ATTEMPTS_SQL = `SELECT
  id,
  test_run_id,
  spec_file,
  test_name,
  original_selector,
  proposed_selector,
  confidence,
  tool_call_count,
  status,
  failure_reason,
  pr_url,
  created_at
FROM heal_attempts
ORDER BY created_at DESC, id DESC
LIMIT $1`;

/**
 * The single seam between the dashboard and PostgreSQL. Deliberately narrow: a text query,
 * positional values, rows out. Implemented by `getRowReader()`; faked in tests.
 */
export type RowReader = (
  text: string,
  values: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>;

export class DashboardDataError extends Error {
  override name = 'DashboardDataError';
}

export interface AttemptSummary {
  readonly total: number;
  readonly byStatus: Readonly<Record<HealStatus, number>>;
  readonly byConfidence: Readonly<Record<HealConfidence, number>>;
  readonly withPr: number;
}

export type AttemptsLoadFailureCode = 'no-database-url' | 'query-failed';

export type AttemptsLoad =
  | {
      readonly ok: true;
      /** Already ordered newest-first by the database. Never re-sorted by the UI. */
      readonly rows: readonly HealAttemptListRow[];
      readonly limit: number;
      readonly truncated: boolean;
    }
  | {
      readonly ok: false;
      readonly code: AttemptsLoadFailureCode;
      /** Safe to render: passed through `redactConnectionUrls`. */
      readonly message: string;
    };

export function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return ATTEMPT_LIST_LIMIT;
  }
  return Math.min(limit, MAX_ATTEMPT_LIST_LIMIT);
}

export function toHealAttemptListRow(raw: Record<string, unknown>): HealAttemptListRow {
  const id = raw.id;
  if (typeof id !== 'string') {
    throw new DashboardDataError(`heal_attempts.id: expected string, got ${typeof id}`);
  }

  const testRunId = raw.test_run_id;
  if (typeof testRunId !== 'string') {
    throw new DashboardDataError(`heal_attempts.test_run_id: expected string, got ${typeof testRunId}`);
  }

  const specFile = raw.spec_file;
  if (typeof specFile !== 'string') {
    throw new DashboardDataError(`heal_attempts.spec_file: expected string, got ${typeof specFile}`);
  }

  const testName = raw.test_name;
  if (typeof testName !== 'string') {
    throw new DashboardDataError(`heal_attempts.test_name: expected string, got ${typeof testName}`);
  }

  const originalSelector = raw.original_selector;
  if (typeof originalSelector !== 'string') {
    throw new DashboardDataError(`heal_attempts.original_selector: expected string, got ${typeof originalSelector}`);
  }

  const proposedSelector = raw.proposed_selector;
  if (proposedSelector === undefined) {
    throw new DashboardDataError(`heal_attempts.proposed_selector: expected string or null, got undefined`);
  }
  const mappedProposedSelector: string | null = proposedSelector === null ? null : String(proposedSelector);

  const confidence = raw.confidence;
  if (!isHealConfidence(confidence)) {
    throw new DashboardDataError(`heal_attempts.confidence: expected HealConfidence, got ${typeof confidence}`);
  }

  const toolCallCount = raw.tool_call_count;
  const numToolCallCount = typeof toolCallCount === 'number' ? toolCallCount : Number(toolCallCount);
  if (!Number.isFinite(numToolCallCount)) {
    throw new DashboardDataError(`heal_attempts.tool_call_count: expected finite number, got ${typeof toolCallCount}`);
  }

  const status = raw.status;
  if (!isHealStatus(status)) {
    throw new DashboardDataError(`heal_attempts.status: expected HealStatus, got ${typeof status}`);
  }

  const failureReason = raw.failure_reason;
  if (failureReason === undefined) {
    throw new DashboardDataError(`heal_attempts.failure_reason: expected string or null, got undefined`);
  }
  const mappedFailureReason: string | null = failureReason === null ? null : String(failureReason);

  const prUrl = raw.pr_url;
  if (prUrl === undefined) {
    throw new DashboardDataError(`heal_attempts.pr_url: expected string or null, got undefined`);
  }
  const mappedPrUrl: string | null = prUrl === null ? null : String(prUrl);

  const createdAt = raw.created_at;
  const isoCreatedAt: string = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);

  return {
    id,
    testRunId,
    specFile,
    testName,
    originalSelector,
    proposedSelector: mappedProposedSelector,
    confidence,
    toolCallCount: numToolCallCount,
    status,
    failureReason: mappedFailureReason,
    prUrl: mappedPrUrl,
    createdAt: isoCreatedAt,
  };
}

export async function listHealAttempts(
  read: RowReader,
  limit?: number,
): Promise<readonly HealAttemptListRow[]> {
  const effective = resolveLimit(limit);
  const rows = await read(LIST_ATTEMPTS_SQL, [effective]);
  return rows.map(toHealAttemptListRow);
}

export function summariseAttempts(rows: readonly HealAttemptListRow[]): AttemptSummary {
  const byStatus: Record<HealStatus, number> = {
    investigating: 0,
    healed: 0,
    needs_review: 0,
    failed: 0,
  };

  const byConfidence: Record<HealConfidence, number> = {
    high: 0,
    low: 0,
    none: 0,
  };

  let withPr = 0;

  for (const row of rows) {
    byStatus[row.status]++;
    byConfidence[row.confidence]++;
    if (row.prUrl !== null) {
      withPr++;
    }
  }

  return {
    total: rows.length,
    byStatus,
    byConfidence,
    withPr,
  };
}

export async function loadAttempts(read: RowReader | null, limit?: number): Promise<AttemptsLoad> {
  if (read === null) {
    return {
      ok: false,
      code: 'no-database-url',
      message: 'DATABASE_URL is not set.',
    };
  }

  const effective = resolveLimit(limit);
  try {
    const rows = await listHealAttempts(read, effective);
    return {
      ok: true,
      rows,
      limit: effective,
      truncated: rows.length >= effective,
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: 'query-failed',
      message: redactConnectionUrls(raw),
    };
  }
}

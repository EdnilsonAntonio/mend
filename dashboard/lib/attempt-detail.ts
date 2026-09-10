import type { HealAttemptDetailRow } from './types';
import type { RowReader } from './attempts';
import { toHealAttemptListRow } from './attempts';
import { redactConnectionUrls } from './format';
import { normaliseTranscript } from './transcript';
import type { TranscriptView } from './transcript';

/** Read-only, single row, primary-key lookup. The one query that selects `transcript`. */
export const DETAIL_ATTEMPT_SQL = `SELECT
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
  transcript,
  created_at
FROM heal_attempts
WHERE id = $1
LIMIT 1`;

export const ATTEMPT_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isAttemptId(value: string): boolean {
  return ATTEMPT_ID_PATTERN.test(value);
}

export function toHealAttemptDetailRow(raw: Record<string, unknown>): HealAttemptDetailRow {
  const base = toHealAttemptListRow(raw);
  return { ...base, transcript: raw.transcript ?? null };
}

export async function getHealAttempt(
  read: RowReader,
  id: string,
): Promise<HealAttemptDetailRow | null> {
  const rows = await read(DETAIL_ATTEMPT_SQL, [id]);
  const first = rows[0];
  if (first === undefined) {
    return null;
  }
  return toHealAttemptDetailRow(first);
}

export type AttemptDetailLoadFailureCode = 'no-database-url' | 'invalid-id' | 'not-found' | 'query-failed';

export type AttemptDetailLoad =
  | {
      readonly ok: true;
      readonly row: HealAttemptDetailRow;
      readonly transcript: TranscriptView;
    }
  | {
      readonly ok: false;
      readonly code: AttemptDetailLoadFailureCode;
      /** Safe to render: passed through `redactConnectionUrls`. Never contains the id. */
      readonly message: string;
      /** The id exactly as it arrived from the URL. Render truncated. */
      readonly attemptId: string;
    };

export async function loadAttemptDetail(
  read: RowReader | null,
  id: string,
): Promise<AttemptDetailLoad> {
  if (read === null) {
    return {
      ok: false,
      code: 'no-database-url',
      message: 'DATABASE_URL is not set.',
      attemptId: id,
    };
  }

  if (!isAttemptId(id)) {
    return {
      ok: false,
      code: 'invalid-id',
      message: 'Not a valid heal attempt id.',
      attemptId: id,
    };
  }

  try {
    const row = await getHealAttempt(read, id);
    if (row === null) {
      return {
        ok: false,
        code: 'not-found',
        message: 'No heal attempt with that id.',
        attemptId: id,
      };
    }
    return {
      ok: true,
      row,
      transcript: normaliseTranscript(row.transcript),
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: 'query-failed',
      message: redactConnectionUrls(raw),
      attemptId: id,
    };
  }
}

import type { MetricsAttemptRow, MetricsScope, RunTestCallRecord, UsageRecord, ConfidenceValue, HealStatusValue } from './types.js';
import { connectRunClient } from '../db/repository.js';

/** The single seam between metrics and PostgreSQL: text in, positional values in, rows out. */
export type MetricsRowReader = (
  text: string,
  values: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>;

export class MetricsQueryError extends Error {
  override name = 'MetricsQueryError';

  constructor(message: string) {
    super(message);
  }
}

/** The one read-only statement. Exported so the README and tests can reference it. */
export const METRICS_ATTEMPTS_SQL = `SELECT
  a.id::text                                             AS id,
  a.test_run_id::text                                    AS test_run_id,
  a.spec_file                                            AS spec_file,
  a.test_name                                            AS test_name,
  a.original_selector                                    AS original_selector,
  a.proposed_selector                                    AS proposed_selector,
  a.confidence::text                                     AS confidence,
  a.tool_call_count                                      AS tool_call_count,
  a.status::text                                         AS status,
  a.failure_reason                                       AS failure_reason,
  a.pr_url                                               AS pr_url,
  a.created_at                                           AS created_at,
  a.transcript ->> 'model'                               AS transcript_model,
  a.transcript ->> 'outcome'                             AS transcript_outcome,
  a.transcript ->> 'confidence'                          AS transcript_confidence,
  a.transcript ->> 'proposedSelector'                    AS transcript_proposed_selector,
  a.transcript ->> 'truncated'                           AS transcript_truncated,
  jsonb_typeof(a.transcript -> 'verification')           AS verification_type,
  a.transcript -> 'verification' ->> 'passed'            AS verification_passed,
  a.transcript -> 'verification' ->> 'executed'          AS verification_executed,
  a.transcript -> 'verification' ->> 'rejected'          AS verification_rejected,
  a.transcript -> 'verification' ->> 'candidateSelector' AS verification_candidate,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'candidate',      tc -> 'result' ->> 'candidate',
      'passed',         tc -> 'result' -> 'passed',
      'executed',       tc -> 'result' -> 'executed',
      'rejected',       tc -> 'result' ->> 'rejected',
      'violationCount', CASE
                          WHEN jsonb_typeof(tc -> 'result' -> 'violations') = 'array'
                          THEN jsonb_array_length(tc -> 'result' -> 'violations')
                          ELSE 0
                        END
    ))
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(a.transcript -> 'transcript' -> 'toolCalls') = 'array'
           THEN a.transcript -> 'transcript' -> 'toolCalls'
           ELSE '[]'::jsonb END
    ) AS tc
    WHERE tc -> 'result' ->> 'kind' = 'run-single-test'
  ), '[]'::jsonb)                                        AS run_test_calls,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'promptTokens',     mr -> 'usage' -> 'promptTokens',
      'completionTokens', mr -> 'usage' -> 'completionTokens',
      'totalTokens',      mr -> 'usage' -> 'totalTokens'
    ))
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(a.transcript -> 'transcript' -> 'modelRequests') = 'array'
           THEN a.transcript -> 'transcript' -> 'modelRequests'
           ELSE '[]'::jsonb END
    ) AS mr
  ), '[]'::jsonb)                                        AS model_usages
FROM heal_attempts a
WHERE ($1::uuid IS NULL OR a.test_run_id = $1::uuid)
  AND ($2::timestamptz IS NULL OR a.created_at >= $2::timestamptz)
ORDER BY a.created_at ASC, a.id ASC`;

// Private helpers for mapping
function readString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string') {
    throw new MetricsQueryError(`${key}: expected string, got ${typeof value}`);
  }
  return value;
}

function readNullableString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function readInt(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  let num: number;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    num = parseInt(value, 10);
  } else {
    throw new MetricsQueryError(`${key}: expected number or string, got ${typeof value}`);
  }
  if (!Number.isFinite(num)) {
    throw new MetricsQueryError(`${key}: not a finite number`);
  }
  return num;
}

function readBooleanText(value: unknown): boolean | null {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return null;
}

function readIso(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

/** Throws MetricsQueryError on any shape violation. */
export function toMetricsAttemptRow(raw: Record<string, unknown>): MetricsAttemptRow {
  const id = readString(raw, 'id');
  const testRunId = readString(raw, 'test_run_id');
  const specFile = readString(raw, 'spec_file');
  const testName = readString(raw, 'test_name');
  const originalSelector = readString(raw, 'original_selector');
  const proposedSelector = readNullableString(raw, 'proposed_selector');
  const toolCallCount = readInt(raw, 'tool_call_count');
  const failureReason = readNullableString(raw, 'failure_reason');
  const prUrl = readNullableString(raw, 'pr_url');
  const createdAt = readIso(raw, 'created_at');
  const transcriptModel = readNullableString(raw, 'transcript_model');
  const transcriptOutcome = readNullableString(raw, 'transcript_outcome');
  const transcriptProposedSelector = readNullableString(raw, 'transcript_proposed_selector');
  const transcriptTruncated = readBooleanText(raw['transcript_truncated']) === true;

  // confidence must be one of the three values
  const confidenceRaw = readString(raw, 'confidence');
  if (confidenceRaw !== 'high' && confidenceRaw !== 'low' && confidenceRaw !== 'none') {
    throw new MetricsQueryError(`confidence: invalid value ${confidenceRaw}`);
  }
  const confidence: ConfidenceValue = confidenceRaw;

  // status must be one of the four values
  const statusRaw = readString(raw, 'status');
  if (statusRaw !== 'investigating' && statusRaw !== 'healed' && statusRaw !== 'needs_review' && statusRaw !== 'failed') {
    throw new MetricsQueryError(`status: invalid value ${statusRaw}`);
  }
  const status: HealStatusValue = statusRaw;

  // transcriptConfidence is null unless it's one of the three values
  const transcriptConfidenceRaw = raw['transcript_confidence'];
  let transcriptConfidence: ConfidenceValue | null = null;
  if (transcriptConfidenceRaw === 'high' || transcriptConfidenceRaw === 'low' || transcriptConfidenceRaw === 'none') {
    transcriptConfidence = transcriptConfidenceRaw;
  }

  // verification
  const verificationPresent = raw['verification_type'] === 'object';
  const verificationPassed = readBooleanText(raw['verification_passed']);
  const verificationExecuted = readBooleanText(raw['verification_executed']);
  const verificationRejected = readNullableString(raw, 'verification_rejected');
  const verificationCandidate = readNullableString(raw, 'verification_candidate');

  // runTestCalls
  const runTestCallsRaw = raw['run_test_calls'];
  let runTestCalls: RunTestCallRecord[] = [];
  if (Array.isArray(runTestCallsRaw)) {
    runTestCalls = runTestCallsRaw.map((item: unknown) => {
      if (typeof item !== 'object' || item === null) {
        throw new MetricsQueryError('run_test_calls: element is not an object');
      }
      const elem = item as Record<string, unknown>;
      const candidate = readNullableString(elem, 'candidate');
      const passed = typeof elem['passed'] === 'boolean' || elem['passed'] === null ? (elem['passed'] as boolean | null) : null;
      const executed = typeof elem['executed'] === 'boolean' || elem['executed'] === null ? (elem['executed'] as boolean | null) : null;
      const rejected = readNullableString(elem, 'rejected');
      let violationCount = 0;
      const vc = elem['violationCount'];
      if (typeof vc === 'number' && Number.isFinite(vc)) {
        violationCount = vc;
      }
      return { candidate, passed, executed, rejected, violationCount };
    });
  }

  // modelUsages
  const modelUsagesRaw = raw['model_usages'];
  let modelUsages: UsageRecord[] = [];
  if (Array.isArray(modelUsagesRaw)) {
    modelUsages = modelUsagesRaw.map((item: unknown) => {
      if (typeof item !== 'object' || item === null) {
        throw new MetricsQueryError('model_usages: element is not an object');
      }
      const elem = item as Record<string, unknown>;
      let promptTokens: number | null = null;
      let completionTokens: number | null = null;
      let totalTokens: number | null = null;
      const pt = elem['promptTokens'];
      if (typeof pt === 'number' && Number.isFinite(pt)) {
        promptTokens = pt;
      }
      const ct = elem['completionTokens'];
      if (typeof ct === 'number' && Number.isFinite(ct)) {
        completionTokens = ct;
      }
      const tt = elem['totalTokens'];
      if (typeof tt === 'number' && Number.isFinite(tt)) {
        totalTokens = tt;
      }
      return { promptTokens, completionTokens, totalTokens };
    });
  }

  return {
    id,
    testRunId,
    specFile,
    testName,
    originalSelector,
    proposedSelector,
    confidence,
    toolCallCount,
    status,
    failureReason,
    prUrl,
    createdAt,
    transcriptModel,
    transcriptOutcome,
    transcriptConfidence,
    transcriptProposedSelector,
    transcriptTruncated,
    verificationPresent,
    verificationPassed,
    verificationExecuted,
    verificationRejected,
    verificationCandidate,
    runTestCalls,
    modelUsages,
  };
}

export async function loadMetricsRows(
  read: MetricsRowReader,
  scope: MetricsScope,
): Promise<readonly MetricsAttemptRow[]> {
  const rows = await read(METRICS_ATTEMPTS_SQL, [scope.testRunId, scope.since]);
  return rows.map(toMetricsAttemptRow);
}

/** Wraps `connectRunClient` from db/repository.js. Caller must always call `close()`. */
export async function createPgRowReader(
  connectionString: string,
  schema?: string,
): Promise<{ readonly read: MetricsRowReader; readonly close: () => Promise<void> }> {
  const client = await connectRunClient(connectionString, schema);
  return {
    read: async (text, values) => (await client.query(text, values as unknown[])).rows,
    close: async () => { await client.end(); },
  };
}

import type { Client as PgClient } from 'pg';
import type {
  ConfidenceLevel,
  HealAssessment,
  HealStatus,
} from '../agent/loop/confidence.js';
import { assertConfidenceInvariant, assertPrEligible } from '../agent/loop/confidence.js';
import { createDbClient, isValidSchemaName } from './client.js';
import { serialiseTranscript } from './transcript.js';
import { TOOL_CALL_COUNT_CEILING } from './schema-contract.js';

export type PersistenceErrorCode =
  | 'missing-connection-string'
  | 'invalid-schema-name'
  | 'invariant-violation'
  | 'not-found'
  | 'query-failed';

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.code = code;
    this.name = 'PersistenceError';
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export interface InsertTestRunInput {
  /** ISO 8601. */
  readonly startedAt: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
}

export interface InsertHealAttemptInput {
  readonly testRunId: string;
  readonly specFile: string;
  readonly testName: string;
  /** `ClassifiedFailure.selector ?? ''`. The column is NOT NULL. */
  readonly originalSelector: string;
}

export interface SettleHealAttemptInput {
  readonly attemptId: string;
  /** Never 'investigating'. */
  readonly status: HealStatus;
  readonly confidence: ConfidenceLevel;
  /** Null if and only if confidence is 'none'. */
  readonly proposedSelector: string | null;
  readonly toolCallCount: number;
  /** Null if and only if confidence is 'high'. */
  readonly failureReason: string | null;
  /** From serialiseTranscript(...).json. Bound to a `::jsonb` parameter. */
  readonly transcriptJson: string;
}

/**
 * Connect to PostgreSQL and optionally set the schema.
 * Throws PersistenceError on connection or schema validation failure.
 */
export async function connectRunClient(
  connectionString: string,
  schema?: string,
): Promise<PgClient> {
  if (connectionString.trim() === '') {
    throw new PersistenceError('missing-connection-string', 'Connection string is empty');
  }

  const client = createDbClient(connectionString);
  try {
    await client.connect();
  } catch (error) {
    await client.end();
    throw new PersistenceError('query-failed', `Failed to connect: ${error}`, { cause: error });
  }

  if (schema !== undefined) {
    if (!isValidSchemaName(schema)) {
      await client.end();
      throw new PersistenceError('invalid-schema-name', `Invalid schema name: ${schema}`);
    }
    try {
      await client.query('SET search_path TO "' + schema + '"');
    } catch (error) {
      await client.end();
      throw new PersistenceError('query-failed', `Failed to set schema: ${error}`, {
        cause: error,
      });
    }
  }

  return client;
}

/**
 * Insert a test run row. Returns the generated UUID.
 */
export async function insertTestRun(client: PgClient, input: InsertTestRunInput): Promise<string> {
  if (
    !(
      input.total >= 0 &&
      input.passed >= 0 &&
      input.failed >= 0 &&
      input.passed + input.failed <= input.total
    )
  ) {
    throw new PersistenceError(
      'invariant-violation',
      `Invalid test counts: total=${input.total}, passed=${input.passed}, failed=${input.failed}`,
    );
  }

  const result = await client.query<{ id: string }>(
    'INSERT INTO test_runs (started_at, total, passed, failed) VALUES ($1, $2, $3, $4) RETURNING id',
    [input.startedAt, input.total, input.passed, input.failed],
  );

  if (!result.rows[0]) {
    throw new PersistenceError('query-failed', 'insertTestRun: no row returned');
  }

  return result.rows[0].id;
}

/**
 * Finish a test run by setting finished_at.
 */
export async function finishTestRun(
  client: PgClient,
  testRunId: string,
  finishedAt: string,
): Promise<void> {
  const result = await client.query(
    'UPDATE test_runs SET finished_at = $2 WHERE id = $1',
    [testRunId, finishedAt],
  );

  if (result.rowCount !== 1) {
    throw new PersistenceError('not-found', `finishTestRun: test run ${testRunId} not found`);
  }
}

/**
 * Insert a heal attempt row in 'investigating' status.
 * Returns the generated UUID.
 */
export async function insertHealAttempt(
  client: PgClient,
  input: InsertHealAttemptInput,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    'INSERT INTO heal_attempts (test_run_id, spec_file, test_name, original_selector) VALUES ($1, $2, $3, $4) RETURNING id',
    [input.testRunId, input.specFile, input.testName, input.originalSelector],
  );

  if (!result.rows[0]) {
    throw new PersistenceError('query-failed', 'insertHealAttempt: no row returned');
  }

  return result.rows[0].id;
}

/**
 * Settle a heal attempt from 'investigating' to a terminal status.
 * The WHERE clause includes AND status = 'investigating' to make this idempotency-safe.
 */
export async function settleHealAttempt(
  client: PgClient,
  input: SettleHealAttemptInput,
): Promise<void> {
  // Validate invariants before querying
  if (input.status === 'investigating') {
    throw new PersistenceError(
      'invariant-violation',
      'Cannot settle to investigating status',
    );
  }

  if (input.toolCallCount < 0 || input.toolCallCount > TOOL_CALL_COUNT_CEILING) {
    throw new PersistenceError(
      'invariant-violation',
      `toolCallCount out of range: ${input.toolCallCount}`,
    );
  }

  if ((input.proposedSelector === null) !== (input.confidence === 'none')) {
    throw new PersistenceError(
      'invariant-violation',
      'proposedSelector must be null iff confidence is none',
    );
  }

  const validPairs: Array<[HealStatus, ConfidenceLevel]> = [
    ['healed', 'high'],
    ['needs_review', 'low'],
    ['failed', 'none'],
  ];
  const isValidPair = validPairs.some(
    ([s, c]) => input.status === s && input.confidence === c,
  );
  if (!isValidPair) {
    throw new PersistenceError(
      'invariant-violation',
      `Invalid status/confidence pair: ${input.status}/${input.confidence}`,
    );
  }

  const result = await client.query(
    `UPDATE heal_attempts
       SET status = $2,
           confidence = $3,
           proposed_selector = $4,
           tool_call_count = $5,
           failure_reason = $6,
           transcript = $7::jsonb
     WHERE id = $1 AND status = 'investigating'`,
    [
      input.attemptId,
      input.status,
      input.confidence,
      input.proposedSelector,
      input.toolCallCount,
      input.failureReason,
      input.transcriptJson,
    ],
  );

  if (result.rowCount !== 1) {
    throw new PersistenceError(
      'not-found',
      `settleHealAttempt: attempt ${input.attemptId} not found or not investigating`,
    );
  }
}

/**
 * Map a HealAssessment to SettleHealAttemptInput.
 * Calls assertConfidenceInvariant first to catch any self-contradictions.
 */
export function toSettleInput(
  attemptId: string,
  assessment: HealAssessment,
): SettleHealAttemptInput {
  assertConfidenceInvariant(assessment);

  return {
    attemptId,
    status: assessment.status,
    confidence: assessment.confidence,
    proposedSelector: assessment.result.proposedSelector,
    toolCallCount: assessment.result.toolCallCount,
    failureReason: assessment.failureReason,
    transcriptJson: serialiseTranscript(assessment).json,
  };
}

export const PR_DELIVERY_FAILURE_REASON_PREFIX = 'pr-delivery-failed';
export const MAX_FAILURE_REASON_CHARS = 500;

/**
 * The only writer of heal_attempts.pr_url. Guarded in SQL so a low/none/already-delivered
 * attempt can never receive a PR URL.
 */
export async function recordPrUrl(
  client: PgClient,
  attemptId: string,
  prUrl: string,
): Promise<void> {
  // Validate the URL before querying
  if (
    !(
      prUrl.startsWith('https://') &&
      prUrl.trim() === prUrl &&
      prUrl.length <= 2000
    )
  ) {
    throw new PersistenceError(
      'invariant-violation',
      `Invalid PR URL: must be https://, trimmed, and <= 2000 chars`,
    );
  }

  const result = await client.query(
    `UPDATE heal_attempts
       SET pr_url = $2
     WHERE id = $1
       AND status = 'healed'
       AND confidence = 'high'
       AND pr_url IS NULL`,
    [attemptId, prUrl],
  );

  if (result.rowCount !== 1) {
    throw new PersistenceError(
      'not-found',
      `recordPrUrl: attempt ${attemptId} not found, not healed/high, or already has a PR URL`,
    );
  }
}

/**
 * Maps a high-confidence assessment whose PR delivery failed to a needs_review settle input.
 * The proposed selector and the full transcript (which still records confidence 'high') are
 * preserved: the fix is never lost. Throws if the assessment is not PR-eligible.
 */
export function toDeliveryFailureSettleInput(
  attemptId: string,
  assessment: HealAssessment,
  deliveryError: string,
): SettleHealAttemptInput {
  // This mapper is only legal for a high-confidence assessment.
  // A throw here is a programming error, not a runtime condition.
  assertPrEligible(assessment);

  // Clamp and format the delivery error message
  const errorMessage = `${PR_DELIVERY_FAILURE_REASON_PREFIX}: ${deliveryError}`
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, MAX_FAILURE_REASON_CHARS);

  return {
    attemptId,
    status: 'needs_review',
    confidence: 'low',
    proposedSelector: assessment.result.proposedSelector, // the fix is kept
    toolCallCount: assessment.result.toolCallCount,
    failureReason: errorMessage,
    transcriptJson: serialiseTranscript(assessment).json, // unmodified: still says high
  };
}

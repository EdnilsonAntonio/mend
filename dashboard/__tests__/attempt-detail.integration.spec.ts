import { test, expect } from '@playwright/test';
import { loadAttemptDetail } from '../lib/attempt-detail';
import type { RowReader } from '../lib/attempts';

const url = process.env.MEND_TEST_DATABASE_URL
  ? typeof process.env.MEND_TEST_DATABASE_URL === 'string' && process.env.MEND_TEST_DATABASE_URL.trim() !== ''
    ? process.env.MEND_TEST_DATABASE_URL.trim()
    : null
  : null;

test.skip(url === null, 'MEND_TEST_DATABASE_URL is not set — see db/README.md');

if (url === null) {
  console.log('[dashboard] MEND_TEST_DATABASE_URL not set — detail integration suite skipped');
}

const schema = `mend_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

let healedId: string;
let failedId: string;

// Dynamic imports to avoid module graph issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let applyMigrations: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createDbClient: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let assessHealResult: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let serialiseTranscript: any;

test.beforeAll(async () => {
  if (url === null) {
    return;
  }

  const migrateModule = await import('../../db/migrate.js');
  const clientModule = await import('../../db/client.js');
  const confidenceModule = await import('../../agent/loop/confidence.js');
  const transcriptModule = await import('../../db/transcript.js');

  applyMigrations = migrateModule.applyMigrations;
  createDbClient = clientModule.createDbClient;
  assessHealResult = confidenceModule.assessHealResult;
  serialiseTranscript = transcriptModule.serialiseTranscript;

  await applyMigrations({
    connectionString: url,
    schema,
  });
});

test.afterAll(async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: healed attempt with high confidence', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const testRunId = '550e8400-e29b-41d4-a716-446655440000';
    healedId = '550e8400-e29b-41d4-a716-446655440001';

    // Insert test run
    await client.query(
      `INSERT INTO test_runs (id, started_at, finished_at, total, passed, failed)
       VALUES ($1, $2::timestamptz, $3::timestamptz, $4, $5, $6)`,
      [testRunId, '2025-01-01T00:00:00Z', '2025-01-01T00:01:00Z', 1, 1, 0]
    );

    // Build healed fixture
    const healedResult = {
      specFile: 'tests/login.spec.ts',
      testName: 'signs in',
      originalSelector: '#login-btn',
      proposedSelector: '#signin-button',
      outcome: 'healed',
      stopReason: 'verified-fix',
      verified: true,
      toolCallCount: 2,
      capReached: false,
      modelTurnCount: 2,
      verification: {
        candidateSelector: '#signin-button',
        passed: true,
        executed: true,
        rejected: null,
        changedLines: [
          {
            lineNumber: 12,
            before: "  await page.click('#login-btn');",
            after: "  await page.click('#signin-button');",
          },
        ],
        output: '1 passed (1.2s)',
        durationMs: 1200,
      },
      model: 'gpt-test',
      startedAt: '2025-01-01T00:00:00.000Z',
      durationMs: 3400,
      errorMessage: null,
      transcript: {
        bootstrapSnapshot: {
          url: 'http://localhost:3000/login',
          html: '<main><button id="signin-button">Sign In</button></main>',
          estimatedTokens: 50,
          elementCount: 2,
          truncated: false,
          capturedAt: '2025-01-01T00:00:00.000Z',
        },
        bootstrapSpecSource: 'describe("Login", () => { test("signs in", () => { ... }) })',
        messages: [{ role: 'user', content: 'Find the selector' }],
        toolCalls: [
          {
            index: 1,
            toolCallId: 'call-1',
            tool: 'get_dom_snapshot',
            ok: true,
            rawArguments: '{}',
            resultSummary: 'Got HTML',
            startedAt: '2025-01-01T00:00:00.000Z',
            durationMs: 100,
            result: {
              kind: 'dom-snapshot',
              url: 'http://localhost:3000/login',
              html: '<main><button id="signin-button">Sign In</button></main>',
              estimatedTokens: 50,
              elementCount: 2,
              truncated: false,
              capturedAt: '2025-01-01T00:00:00.000Z',
            },
          },
          {
            index: 2,
            toolCallId: 'call-2',
            tool: 'run_single_test',
            ok: true,
            rawArguments: '{"selector":"#signin-button"}',
            resultSummary: 'Test passed',
            startedAt: '2025-01-01T00:00:02.000Z',
            durationMs: 1200,
            result: {
              kind: 'run-single-test',
              candidate: '#signin-button',
              passed: true,
              executed: true,
              rejected: null,
              violations: [],
              changedLines: [
                {
                  lineNumber: 12,
                  before: "  await page.click('#login-btn');",
                  after: "  await page.click('#signin-button');",
                },
              ],
              output: '1 passed (1.2s)',
            },
          },
        ],
        modelRequests: [
          {
            turn: 1,
            finishReason: 'tool_calls',
            contentPreview: 'I will find the selector.',
            requestedTools: ['get_dom_snapshot', 'run_single_test'],
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          },
        ],
      },
    };

    const healedMeasurement = {
      selector: '#signin-button',
      matchCount: 1,
      measured: true,
      error: null,
      measuredAt: '2025-01-01T00:00:01.000Z',
      durationMs: 12,
    };

    // Assess to create proper transcript
    const assessment = assessHealResult(healedResult, healedMeasurement);
    const serialised = serialiseTranscript(assessment);

    // Insert healed attempt with values derived from the assessment
    await client.query(
      `INSERT INTO heal_attempts (
         id, test_run_id, spec_file, test_name, original_selector, proposed_selector,
         confidence, status, tool_call_count, failure_reason, pr_url, transcript, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::timestamptz)`,
      [
        healedId,
        testRunId,
        healedResult.specFile,
        healedResult.testName,
        healedResult.originalSelector,
        assessment.result.proposedSelector,
        assessment.confidence,
        assessment.status,
        assessment.result.toolCallCount,
        assessment.failureReason,
        null,
        serialised.json,
        '2025-01-01T00:00:00Z',
      ]
    );

    // Test the detail loader
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const result = await loadAttemptDetail(read, healedId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.status).toBe('healed');
      expect(result.row.confidence).toBe('high');
      expect(result.row.proposedSelector).toBe('#signin-button');
      expect(result.transcript.kind).toBe('envelope');
    }
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: failed attempt with no confidence', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const testRunId = '550e8400-e29b-41d4-a716-446655440000';
    failedId = '550e8400-e29b-41d4-a716-446655440002';

    // Build failed fixture
    const failedResult = {
      specFile: 'tests/login.spec.ts',
      testName: 'signs in',
      originalSelector: '#login-btn',
      proposedSelector: null,
      outcome: 'no-fix',
      stopReason: 'tool-call-cap-reached',
      verified: false,
      toolCallCount: 5,
      capReached: true,
      modelTurnCount: 2,
      verification: {
        candidateSelector: '#attempt-5',
        passed: false,
        executed: true,
        rejected: null,
        changedLines: [],
        output: '1 failed',
        durationMs: 800,
      },
      model: 'gpt-test',
      startedAt: '2025-01-01T00:00:00.000Z',
      durationMs: 5000,
      errorMessage: null,
      transcript: {
        bootstrapSnapshot: {
          url: 'http://localhost:3000/login',
          html: '<main><button id="login-btn">Login</button></main>',
          estimatedTokens: 50,
          elementCount: 2,
          truncated: false,
          capturedAt: '2025-01-01T00:00:00.000Z',
        },
        bootstrapSpecSource: 'describe("Login", () => { test("signs in", () => { ... }) })',
        messages: [],
        toolCalls: Array.from({ length: 5 }, (_, i) => ({
          index: i + 1,
          toolCallId: `call-${i + 1}`,
          tool: 'query_selector',
          ok: false,
          rawArguments: `{"selector":"#attempt-${i + 1}"}`,
          resultSummary: '0 matches',
          startedAt: `2025-01-01T00:00:0${i}.000Z`,
          durationMs: 50,
          result: {
            kind: 'query-selector',
            selector: `#attempt-${i + 1}`,
            matchCount: 0,
            previews: [],
            previewsTruncated: false,
            error: null,
          },
        })),
        modelRequests: [],
      },
    };

    const assessment = assessHealResult(failedResult, null);
    const serialised = serialiseTranscript(assessment);

    // Insert failed attempt with values derived from the assessment
    await client.query(
      `INSERT INTO heal_attempts (
         id, test_run_id, spec_file, test_name, original_selector, proposed_selector,
         confidence, status, tool_call_count, failure_reason, pr_url, transcript, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::timestamptz)`,
      [
        failedId,
        testRunId,
        failedResult.specFile,
        failedResult.testName,
        failedResult.originalSelector,
        assessment.result.proposedSelector,
        assessment.confidence,
        assessment.status,
        assessment.result.toolCallCount,
        assessment.failureReason,
        null,
        serialised.json,
        '2025-01-01T00:00:10Z',
      ]
    );

    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const result = await loadAttemptDetail(read, failedId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.status).toBe('failed');
      expect(result.row.confidence).toBe('none');
      expect(result.row.proposedSelector).toBeNull();
      expect(result.transcript.kind).toBe('envelope');
    }
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: steps match tool_call_count', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const healed = await loadAttemptDetail(read, healedId);
    const failed = await loadAttemptDetail(read, failedId);

    expect(healed.ok).toBe(true);
    expect(failed.ok).toBe(true);

    if (healed.ok && healed.transcript.kind === 'envelope') {
      expect(healed.transcript.steps.length).toBe(healed.row.toolCallCount);
    }
    if (failed.ok && failed.transcript.kind === 'envelope') {
      expect(failed.transcript.steps.length).toBe(failed.row.toolCallCount);
    }
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: healed run-single-test step proves execution', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const result = await loadAttemptDetail(read, healedId);

    expect(result.ok).toBe(true);
    if (result.ok && result.transcript.kind === 'envelope') {
      const runTestStep = result.transcript.steps.find(
        (s) => s.detail.kind === 'run-single-test'
      );
      expect(runTestStep).toBeDefined();
      if (runTestStep?.detail.kind === 'run-single-test') {
        expect(runTestStep.detail.passed).toBe(true);
        expect(runTestStep.detail.executed).toBe(true);
      }
    }
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: bootstrap snapshot HTML byte-identical', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const result = await loadAttemptDetail(read, healedId);

    expect(result.ok).toBe(true);
    if (result.ok && result.transcript.kind === 'envelope') {
      expect(result.transcript.bootstrapSnapshot?.html).toBe(
        '<main><button id="signin-button">Sign In</button></main>'
      );
    }
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: healed recorded confidence', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const result = await loadAttemptDetail(read, healedId);

    expect(result.ok).toBe(true);
    if (result.ok && result.transcript.kind === 'envelope') {
      expect(result.transcript.recordedConfidence).toBe('high');
      expect(result.transcript.reasons).toEqual([]);
      expect(result.transcript.measurement?.matchCount).toBe(1);
    }
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: failed recorded status and reasons', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const result = await loadAttemptDetail(read, failedId);

    expect(result.ok).toBe(true);
    if (result.ok && result.transcript.kind === 'envelope') {
      expect(result.transcript.recordedConfidence).toBe('none');
      expect(result.transcript.reasons).toContain('no-verified-fix');
      expect(result.transcript.reasons).toContain('cap-reached-without-fix');
      expect(result.transcript.verification?.passed).toBe(false);
      expect(result.transcript.steps.length).toBe(5);
    }
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: not found', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const result = await loadAttemptDetail(read, '550e8400-e29b-41d4-a716-4466554499ff');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not-found');
    }
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: invalid id', async () => {
  if (url === null) return;

  const read: RowReader = async () => [];
  const result = await loadAttemptDetail(read, 'nope');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('invalid-id');
  }
});

test('loadAttemptDetail: read-only - no rows inserted', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const beforeCount = await client.query('SELECT count(*) FROM heal_attempts');
    const beforeRow = beforeCount.rows[0];
    const before = beforeRow ? Number(beforeRow.count) : 0;

    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    await loadAttemptDetail(read, healedId);

    const afterCount = await client.query('SELECT count(*) FROM heal_attempts');
    const afterRow = afterCount.rows[0];
    const after = afterRow ? Number(afterRow.count) : 0;

    expect(after).toBe(before);
    expect(before).toBe(2);
  } finally {
    await client.end();
  }
});

test('loadAttemptDetail: message count available', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const result = await loadAttemptDetail(read, healedId);

    expect(result.ok).toBe(true);
    if (result.ok && result.transcript.kind === 'envelope') {
      expect(result.transcript.messageCount).toBeGreaterThanOrEqual(1);
    }
  } finally {
    await client.end();
  }
});

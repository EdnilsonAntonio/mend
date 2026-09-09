import { test, expect } from '@playwright/test';
import { listHealAttempts, loadAttempts, ATTEMPT_LIST_LIMIT } from '../lib/attempts';
import type { RowReader } from '../lib/attempts';

const url = process.env.MEND_TEST_DATABASE_URL
  ? typeof process.env.MEND_TEST_DATABASE_URL === 'string' && process.env.MEND_TEST_DATABASE_URL.trim() !== ''
    ? process.env.MEND_TEST_DATABASE_URL.trim()
    : null
  : null;

test.skip(url === null, 'MEND_TEST_DATABASE_URL is not set — see db/README.md');

if (url === null) {
  console.log('[dashboard] MEND_TEST_DATABASE_URL not set — integration suite skipped');
}

const schema = `mend_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Valid UUIDs for fixture data, shared across all tests
let testRunId: string;
let attemptId1: string;
let attemptId2: string;
let attemptId3: string;
let attemptId4: string;

// Use dynamic imports to avoid loading TypeScript modules in CommonJS context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let applyMigrations: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createDbClient: any;

test.beforeAll(async () => {
  if (url === null) {
    return;
  }
  // Dynamic import to avoid module context issues
  const migrateModule = await import('../../db/migrate.js');
  const clientModule = await import('../../db/client.js');
  applyMigrations = migrateModule.applyMigrations;
  createDbClient = clientModule.createDbClient;
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

test('listHealAttempts: returns rows newest first', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    // Initialize valid UUIDs for fixture
    testRunId = '550e8400-e29b-41d4-a716-446655440000';
    attemptId1 = '550e8400-e29b-41d4-a716-446655440001';
    attemptId2 = '550e8400-e29b-41d4-a716-446655440002';
    attemptId3 = '550e8400-e29b-41d4-a716-446655440003';
    attemptId4 = '550e8400-e29b-41d4-a716-446655440004';

    // Insert test_run with correct columns and valid UUID
    await client.query(
      `INSERT INTO test_runs (id, started_at, finished_at, total, passed, failed)
       VALUES ($1, $2::timestamptz, $3::timestamptz, $4, $5, $6)`,
      [testRunId, '2025-01-01T00:00:00Z', '2025-01-01T00:01:00Z', 4, 3, 1]
    );

    // Insert four heal_attempts with explicit created_at and valid UUIDs
    await client.query(
      `INSERT INTO heal_attempts (
         id, test_run_id, spec_file, test_name, original_selector, proposed_selector,
         confidence, status, tool_call_count, failure_reason, pr_url, created_at
       ) VALUES
         ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, NULL, $10::timestamptz),
         ($11, $2, $3, $12, $13, $14, $15, $16, $17, $18, NULL, $19::timestamptz),
         ($20, $2, $3, $21, $22, $23, $24, $25, $26, NULL, $27, $28::timestamptz),
         ($29, $2, $3, $30, $31, NULL, $32, $33, $34, NULL, NULL, $35::timestamptz)`,
      [
        attemptId1, testRunId, 'specs/app.spec.ts', 'test 1', '#old1', 'none', 'failed', 1, 'no fix found', '2025-01-01T00:00:00Z',
        attemptId2, 'test 2', '#old2', '#b', 'low', 'needs_review', 2, 'ambiguous match', '2025-01-02T00:00:00Z',
        attemptId3, 'test 3', '#old3', '#c', 'high', 'healed', 3, 'https://github.com/o/r/pull/7', '2025-01-03T00:00:00Z',
        attemptId4, 'test 4', '#old4', 'none', 'investigating', 4, '2025-01-04T00:00:00Z',
      ]
    );

    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const rows = await listHealAttempts(read);

    expect(rows).toHaveLength(4);
    // Newest first: attemptId4, attemptId3, attemptId2, attemptId1
    expect(rows[0]?.proposedSelector).toBeNull();
    expect(rows[1]?.proposedSelector).toBe('#c');
    expect(rows[2]?.proposedSelector).toBe('#b');
    expect(rows[3]?.proposedSelector).toBeNull();
  } finally {
    await client.end();
  }
});

test('listHealAttempts: all status/confidence values map without throwing', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const rows = await listHealAttempts(read);

    // Verify all four status values are present
    const statuses = new Set(rows.map((r) => r.status));
    expect(statuses).toContain('failed');
    expect(statuses).toContain('needs_review');
    expect(statuses).toContain('healed');
    expect(statuses).toContain('investigating');

    // Verify all three confidence values are present
    const confidences = new Set(rows.map((r) => r.confidence));
    expect(confidences).toContain('high');
    expect(confidences).toContain('low');
    expect(confidences).toContain('none');
  } finally {
    await client.end();
  }
});

test('listHealAttempts: prUrl mapping', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const rows = await listHealAttempts(read);

    const healedRow = rows.find((r) => r.status === 'healed');
    expect(healedRow?.prUrl).toBe('https://github.com/o/r/pull/7');

    const failedRow = rows.find((r) => r.status === 'failed');
    expect(failedRow?.prUrl).toBeNull();

    const needsReviewRow = rows.find((r) => r.status === 'needs_review');
    expect(needsReviewRow?.prUrl).toBeNull();

    const investigatingRow = rows.find((r) => r.status === 'investigating');
    expect(investigatingRow?.prUrl).toBeNull();
  } finally {
    await client.end();
  }
});

test('listHealAttempts: failureReason mapping', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const rows = await listHealAttempts(read);

    const failedRow = rows.find((r) => r.status === 'failed');
    expect(failedRow?.failureReason).toBe('no fix found');
    expect(failedRow?.proposedSelector).toBeNull();
  } finally {
    await client.end();
  }
});

test('listHealAttempts: createdAt format', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const rows = await listHealAttempts(read);

    for (const row of rows) {
      expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  } finally {
    await client.end();
  }
});

test('listHealAttempts: transcript not in result', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const rows = await listHealAttempts(read);

    for (const row of rows) {
      expect('transcript' in row).toBe(false);
    }
  } finally {
    await client.end();
  }
});

test('listHealAttempts: limit parameter', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const rows = await listHealAttempts(read, 2);

    expect(rows).toHaveLength(2);
    // Should be the two newest: attemptId4, attemptId3
    expect(rows[0]?.id).toBe(attemptId4);
    expect(rows[1]?.id).toBe(attemptId3);
  } finally {
    await client.end();
  }
});

test('loadAttempts: ok with correct shape', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    const result = await loadAttempts(read);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(false);
      expect(result.limit).toBe(ATTEMPT_LIST_LIMIT);
      expect(result.rows).toHaveLength(4);
    }
  } finally {
    await client.end();
  }
});

test('loadAttempts: does not write', async () => {
  if (url === null) return;

  const client = createDbClient(url);
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);

  try {
    const beforeCount = await client.query('SELECT count(*) FROM heal_attempts');
    const beforeRow = beforeCount.rows[0];
    const beforeRows = beforeRow ? Number(beforeRow.count) : 0;

    const read: RowReader = async (text, values) =>
      (await client.query(text, values as unknown[])).rows as readonly Record<string, unknown>[];

    await loadAttempts(read);

    const afterCount = await client.query('SELECT count(*) FROM heal_attempts');
    const afterRow = afterCount.rows[0];
    const afterRows = afterRow ? Number(afterRow.count) : 0;

    expect(afterRows).toBe(beforeRows);
    expect(beforeRows).toBe(4);
  } finally {
    await client.end();
  }
});

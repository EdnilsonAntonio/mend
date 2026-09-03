import { test, expect } from '@playwright/test';
import { applyMigrations } from '../migrate.js';
import { resolveTestDatabaseUrl, createDbClient } from '../client.js';
import { loadMigrationFiles } from '../migration-files.js';
import {
  TEST_RUNS_COLUMNS,
  HEAL_ATTEMPTS_COLUMNS,
  HEAL_CONFIDENCE_VALUES,
  HEAL_STATUS_VALUES,
} from '../schema-contract.js';

const url = resolveTestDatabaseUrl(process.env);

test.skip(url === null, 'MEND_TEST_DATABASE_URL is not set — see db/README.md');

if (url === null) {
  console.log('[db] MEND_TEST_DATABASE_URL not set — integration suite skipped');
}

const schema = `mend_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Store the migration report from beforeAll so tests can reference it.
let migrationReport: Awaited<ReturnType<typeof applyMigrations>> | null = null;

test.beforeAll(async () => {
  if (url === null) {
    return;
  }
  migrationReport = await applyMigrations({
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

test('schema is not public', () => {
  expect(schema).not.toBe('public');
});

test('applyMigrations on fresh schema applies both migrations', async () => {
  expect(migrationReport).toBeDefined();
  expect(migrationReport?.newlyApplied).toHaveLength(2);
  expect(migrationReport?.newlyApplied.map(m => m.version)).toEqual(['0001', '0002']);
  expect(migrationReport?.pendingAfter).toHaveLength(0);
});

test('running applyMigrations a second time is idempotent', async () => {
  if (url === null) {
    return;
  }
  const report = await applyMigrations({
    connectionString: url,
    schema,
  });

  expect(report.newlyApplied).toHaveLength(0);
  expect(report.alreadyApplied).toEqual(['0001', '0002']);
});

test('schema_migrations has 2 rows with matching checksums', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    const result = await client.query<{
      version: string;
      checksum: string;
      execution_ms: number;
    }>('SELECT version, checksum, execution_ms FROM schema_migrations ORDER BY version ASC');

    expect(result.rows).toHaveLength(2);

    const files = await loadMigrationFiles();
    for (let i = 0; i < 2; i++) {
      const row = result.rows[i];
      const file = files[i];
      expect(row?.version).toBe(file?.version);
      expect(row?.checksum).toBe(file?.checksum);
      expect((row?.execution_ms ?? 0) >= 0).toBe(true);
    }
  } finally {
    await client.end();
  }
});

test('test_runs table has expected columns', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    const result = await client.query<{
      column_name: string;
      udt_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name, udt_name, is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'test_runs'
       ORDER BY ordinal_position`,
      [schema],
    );

    expect(result.rows).toHaveLength(TEST_RUNS_COLUMNS.length);

    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      const expected = TEST_RUNS_COLUMNS[i];

      expect(row?.column_name).toBe(expected?.name);
      expect(row?.udt_name).toBe(expected?.udtName);
      expect(row?.is_nullable).toBe(expected?.nullable ? 'YES' : 'NO');
    }
  } finally {
    await client.end();
  }
});

test('heal_attempts table has expected columns', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    const result = await client.query<{
      column_name: string;
      udt_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name, udt_name, is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'heal_attempts'
       ORDER BY ordinal_position`,
      [schema],
    );

    expect(result.rows).toHaveLength(HEAL_ATTEMPTS_COLUMNS.length);

    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      const expected = HEAL_ATTEMPTS_COLUMNS[i];

      expect(row?.column_name).toBe(expected?.name);
      expect(row?.udt_name).toBe(expected?.udtName);
      expect(row?.is_nullable).toBe(expected?.nullable ? 'YES' : 'NO');
    }
  } finally {
    await client.end();
  }
});

test('enum heal_confidence has expected members', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    const result = await client.query<{
      enumlabel: string;
    }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
       JOIN pg_namespace ON pg_type.typnamespace = pg_namespace.oid
       WHERE pg_type.typname = $1 AND pg_namespace.nspname = $2
       ORDER BY pg_enum.enumsortorder`,
      ['heal_confidence', schema],
    );

    const members = result.rows.map(r => r?.enumlabel).filter(Boolean) as string[];
    expect(members).toEqual(HEAL_CONFIDENCE_VALUES);
  } finally {
    await client.end();
  }
});

test('enum heal_status has expected members', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    const result = await client.query<{
      enumlabel: string;
    }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
       JOIN pg_namespace ON pg_type.typnamespace = pg_namespace.oid
       WHERE pg_type.typname = $1 AND pg_namespace.nspname = $2
       ORDER BY pg_enum.enumsortorder`,
      ['heal_status', schema],
    );

    const members = result.rows.map(r => r?.enumlabel).filter(Boolean) as string[];
    expect(members).toEqual(HEAL_STATUS_VALUES);
  } finally {
    await client.end();
  }
});

test('can insert test_runs row with defaults', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    const result = await client.query<{
      id: string;
      started_at: string;
      finished_at: null;
      total: number;
      passed: number;
      failed: number;
    }>('INSERT INTO test_runs DEFAULT VALUES RETURNING *');

    const row = result.rows[0];
    expect(row).toBeDefined();
    expect(typeof row?.id).toBe('string'); // UUID
    // pg returns Date objects for timestamptz columns
    expect((row?.started_at as unknown) instanceof Date).toBe(true);
    expect(row?.finished_at).toBeNull();
    expect(row?.total).toBe(0);
    expect(row?.passed).toBe(0);
    expect(row?.failed).toBe(0);
  } finally {
    await client.end();
  }
});

test('can insert heal_attempts row with defaults', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    // First, insert a test_run to reference.
    const runResult = await client.query<{ id: string }>(
      'INSERT INTO test_runs DEFAULT VALUES RETURNING id',
    );
    const runId = runResult.rows[0]?.id;
    expect(runId).toBeDefined();

    const result = await client.query<{
      id: string;
      confidence: string;
      status: string;
      tool_call_count: number;
      transcript: object;
    }>(
      `INSERT INTO heal_attempts (test_run_id, spec_file, test_name, original_selector)
       VALUES ($1, $2, $3, $4)
       RETURNING id, confidence, status, tool_call_count, transcript`,
      [runId, 'spec.ts', 'test name', '#selector'],
    );

    const row = result.rows[0];
    expect(row?.confidence).toBe('none');
    expect(row?.status).toBe('investigating');
    expect(row?.tool_call_count).toBe(0);
    expect(row?.transcript).toEqual({});
  } finally {
    await client.end();
  }
});

test('constraint: pr_url requires high confidence', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    // Insert a test_run.
    const runResult = await client.query<{ id: string }>(
      'INSERT INTO test_runs DEFAULT VALUES RETURNING id',
    );
    const runId = runResult.rows[0]?.id;
    expect(runId).toBeDefined();

    let caught: unknown;
    try {
      await client.query(
        `INSERT INTO heal_attempts (test_run_id, spec_file, test_name, original_selector, pr_url, confidence)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [runId, 'spec.ts', 'test', '#sel', 'https://example.com', 'low'],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { constraint?: string }).constraint).toBe('heal_attempts_pr_url_requires_high_confidence');
  } finally {
    await client.end();
  }
});

test('constraint: status must match confidence', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    // Insert a test_run.
    const runResult = await client.query<{ id: string }>(
      'INSERT INTO test_runs DEFAULT VALUES RETURNING id',
    );
    const runId = runResult.rows[0]?.id;
    expect(runId).toBeDefined();

    let caught: unknown;
    try {
      await client.query(
        `INSERT INTO heal_attempts (test_run_id, spec_file, test_name, original_selector, proposed_selector, status, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [runId, 'spec.ts', 'test', '#sel', '#new', 'healed', 'low'],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { constraint?: string }).constraint).toBe('heal_attempts_status_matches_confidence');
  } finally {
    await client.end();
  }
});

test('constraint: proposed_selector requires non-none confidence', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    // Insert a test_run.
    const runResult = await client.query<{ id: string }>(
      'INSERT INTO test_runs DEFAULT VALUES RETURNING id',
    );
    const runId = runResult.rows[0]?.id;
    expect(runId).toBeDefined();

    let caught: unknown;
    try {
      await client.query(
        `INSERT INTO heal_attempts (test_run_id, spec_file, test_name, original_selector, proposed_selector, confidence)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [runId, 'spec.ts', 'test', '#sel', '#new', 'none'],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { constraint?: string }).constraint).toBe('heal_attempts_selector_requires_verification');
  } finally {
    await client.end();
  }
});

test('constraint: tool_call_count cannot exceed 5', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    // Insert a test_run.
    const runResult = await client.query<{ id: string }>(
      'INSERT INTO test_runs DEFAULT VALUES RETURNING id',
    );
    const runId = runResult.rows[0]?.id;
    expect(runId).toBeDefined();

    let caught: unknown;
    try {
      await client.query(
        `INSERT INTO heal_attempts (test_run_id, spec_file, test_name, original_selector, tool_call_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [runId, 'spec.ts', 'test', '#sel', 6],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { constraint?: string }).constraint).toBe('heal_attempts_tool_call_count_within_cap');
  } finally {
    await client.end();
  }
});

test('constraint: test_run_id must reference valid test_run', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    const randomUuid = '00000000-0000-0000-0000-000000000000';

    let caught: unknown;
    try {
      await client.query(
        `INSERT INTO heal_attempts (test_run_id, spec_file, test_name, original_selector)
         VALUES ($1, $2, $3, $4)`,
        [randomUuid, 'spec.ts', 'test', '#sel'],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { constraint?: string }).constraint).toBe('heal_attempts_test_run_id_fkey');
  } finally {
    await client.end();
  }
});

test('transcript can round-trip nested objects', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    // Insert a test_run.
    const runResult = await client.query<{ id: string }>(
      'INSERT INTO test_runs DEFAULT VALUES RETURNING id',
    );
    const runId = runResult.rows[0]?.id;
    expect(runId).toBeDefined();

    const transcript = { toolCalls: [{ tool: 'run_single_test', arg: 'value' }] };

    await client.query(
      `INSERT INTO heal_attempts (test_run_id, spec_file, test_name, original_selector, transcript)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, 'spec.ts', 'test', '#sel', JSON.stringify(transcript)],
    );

    const result = await client.query<{ transcript: object }>(
      `SELECT transcript FROM heal_attempts
       WHERE transcript @> '{"toolCalls":[{"tool":"run_single_test"}]}'::jsonb`,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.transcript).toEqual(transcript);
  } finally {
    await client.end();
  }
});

test('DELETE CASCADE removes heal_attempts when test_run is deleted', async () => {
  if (url === null) {
    return;
  }
  const client = createDbClient(url);
  try {
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);

    // Insert a test_run.
    const runResult = await client.query<{ id: string }>(
      'INSERT INTO test_runs DEFAULT VALUES RETURNING id',
    );
    const runId = runResult.rows[0]?.id;
    expect(runId).toBeDefined();

    // Insert a heal_attempt.
    await client.query(
      `INSERT INTO heal_attempts (test_run_id, spec_file, test_name, original_selector)
       VALUES ($1, $2, $3, $4)`,
      [runId, 'spec.ts', 'test', '#sel'],
    );

    // Delete the test_run.
    await client.query('DELETE FROM test_runs WHERE id = $1', [runId]);

    // Verify heal_attempt is also deleted.
    const result = await client.query('SELECT COUNT(*) as count FROM heal_attempts WHERE test_run_id = $1', [
      runId,
    ]);
    // pg returns COUNT as a string, so convert to number for comparison
    expect(Number((result.rows[0] as any)?.count)).toBe(0);
  } finally {
    await client.end();
  }
});

test('applyMigrations rejects invalid schema name', async () => {
  if (url === null) {
    return;
  }
  let caught: unknown;
  try {
    await applyMigrations({
      connectionString: url,
      schema: 'Bad Name',
    });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  expect((caught as { code?: string }).code).toBe('invalid-schema-name');
});

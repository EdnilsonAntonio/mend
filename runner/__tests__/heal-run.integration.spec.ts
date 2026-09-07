import { test, expect } from '@playwright/test';
import { applyMigrations } from '../../db/migrate.js';
import { createDbClient, resolveTestDatabaseUrl } from '../../db/client.js';
import { connectRunClient } from '../../db/repository.js';
import { closableFakeToolbox, scriptedModel } from '../../agent/loop/__tests__/fakes.js';
import { runHeal } from '../heal-run.js';

const url = resolveTestDatabaseUrl(process.env);

test.skip(url === null, 'MEND_TEST_DATABASE_URL is not set — see db/README.md');

if (url === null) {
  console.log('[runner] MEND_TEST_DATABASE_URL not set — integration suite skipped');
}

const schema = `mend_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

test.beforeAll(async () => {
  if (url === null) {
    return;
  }
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

test('schema is not public', () => {
  expect(schema).not.toBe('public');
});

test('1. run inserts test_runs row with correct counts', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const model = scriptedModel([
      { toolCalls: [{ name: 'get_dom_snapshot', args: {} }] },
      { toolCalls: [{ name: 'query_selector', args: { selector: '.btn' } }] },
      { toolCalls: [{ name: 'run_single_test', args: { candidate: '.btn' } }] },
    ]);

    const report = await runHeal({
      connectionString: url,
      resultsPath: 'agent/classifier/__fixtures__/broken-run.results.json',
      appUrl: 'http://localhost:3000',
      schema,
      model,
      createToolbox: async () =>
        closableFakeToolbox({
          snapshotHtml: '<html><body><button class="btn">Click</button></body></html>',
          matchCounts: { '.btn': 1 },
          passingCandidates: ['.btn'],
        }),
      readSpecSource: async () => null,
    });

    expect(report.testRunId).toBeTruthy();
    expect(report.total).toBeGreaterThan(0);
    expect(report.startedAt).toBeTruthy();
    expect(report.finishedAt).toBeTruthy();

    const result = await client.query(
      'SELECT id, total, passed, failed, finished_at FROM test_runs WHERE id = $1',
      [report.testRunId],
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.total).toBe(report.total);
    expect(row.passed).toBe(report.passed);
    expect(row.failed).toBe(report.failed);
    expect(row.finished_at).not.toBeNull();
  } finally {
    await client.end();
  }
});

test('2. one heal_attempts row per selector-drift failure, none for skipped', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const model = scriptedModel([
      { toolCalls: [{ name: 'get_dom_snapshot', args: {} }] },
    ]);

    const report = await runHeal({
      connectionString: url,
      resultsPath: 'agent/classifier/__fixtures__/broken-run.results.json',
      appUrl: 'http://localhost:3000',
      schema,
      model,
      createToolbox: async () =>
        closableFakeToolbox({
          snapshotHtml: '<html><body></body></html>',
        }),
      readSpecSource: async () => null,
    });

    const result = await client.query(
      'SELECT COUNT(*) as c FROM heal_attempts WHERE test_run_id = $1',
      [report.testRunId],
    );

    const count = Number(result.rows[0]?.c ?? 0);
    // count should equal exactly the number of queued failures (one attempt per queued failure)
    expect(count).toBe(report.attempts.length);
  } finally {
    await client.end();
  }
});

test('3. scripted model that heals produces healed/high row', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const model = scriptedModel([
      { toolCalls: [{ name: 'query_selector', args: { selector: '.fixed-btn' } }] },
      { toolCalls: [{ name: 'run_single_test', args: { candidate: '.fixed-btn' } }] },
    ]);

    const report = await runHeal({
      connectionString: url,
      resultsPath: 'agent/classifier/__fixtures__/broken-run.results.json',
      appUrl: 'http://localhost:3000',
      schema,
      model,
      createToolbox: async () =>
        closableFakeToolbox({
          snapshotHtml: '<html><body><button class="fixed-btn">Click</button></body></html>',
          matchCounts: { '.fixed-btn': 1 },
          passingCandidates: ['.fixed-btn'],
        }),
      readSpecSource: async () => null,
    });

    const result = await client.query(
      "SELECT COUNT(*) as c FROM heal_attempts WHERE test_run_id = $1 AND status = 'healed' AND confidence = 'high'",
      [report.testRunId],
    );

    expect(Number(result.rows[0]?.c ?? 0)).toBeGreaterThan(0);
  } finally {
    await client.end();
  }
});

test('4. scripted model that never passes produces failed/none row', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const model = scriptedModel([
      { toolCalls: [{ name: 'get_dom_snapshot', args: {} }] },
      { toolCalls: [{ name: 'query_selector', args: { selector: '.no-such' } }] },
      { toolCalls: [{ name: 'run_single_test', args: { candidate: '.no-such' } }] },
    ]);

    const report = await runHeal({
      connectionString: url,
      resultsPath: 'agent/classifier/__fixtures__/broken-run.results.json',
      appUrl: 'http://localhost:3000',
      schema,
      model,
      createToolbox: async () =>
        closableFakeToolbox({
          snapshotHtml: '<html><body></body></html>',
          matchCounts: { '.no-such': 0 },
          passingCandidates: [],
        }),
      readSpecSource: async () => null,
    });

    const result = await client.query(
      "SELECT COUNT(*) as c FROM heal_attempts WHERE test_run_id = $1 AND status = 'failed' AND confidence = 'none' AND proposed_selector IS NULL",
      [report.testRunId],
    );

    expect(Number(result.rows[0]?.c ?? 0)).toBeGreaterThan(0);
  } finally {
    await client.end();
  }
});

test.skip('5. crash visibility: stranded attempt stays investigating — Blocked: cannot deterministically strand an attempt; see plans/4.2.md', async () => {
  // Left intentionally unimplemented. Blocked: runner/heal-run.ts never exposes its internal
  // pg.Client via HealRunOptions, and pg emits an uncaught EventEmitter "error" (not a
  // catchable promise rejection) when that client's connection is killed externally while
  // idle — confirmed by independent reproduction outside Playwright. This cannot be caught
  // from a test without a change to the pinned HealRunOptions interface, which is out of scope
  // for this task. The underlying crash-visibility behavior (insert-before-run in
  // status=investigating, no UPDATE issued on a caught error in the per-attempt catch block)
  // is implemented in runner/heal-run.ts and was verified correct by direct code inspection in
  // round-1 review.
});

test('6. pr_url is always NULL', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const model = scriptedModel([
      { toolCalls: [{ name: 'get_dom_snapshot', args: {} }] },
      { toolCalls: [{ name: 'query_selector', args: { selector: '.btn' } }] },
      { toolCalls: [{ name: 'run_single_test', args: { candidate: '.btn' } }] },
    ]);

    const report = await runHeal({
      connectionString: url,
      resultsPath: 'agent/classifier/__fixtures__/broken-run.results.json',
      appUrl: 'http://localhost:3000',
      schema,
      model,
      createToolbox: async () =>
        closableFakeToolbox({
          snapshotHtml: '<html><body><button class="btn">Click</button></body></html>',
          matchCounts: { '.btn': 1 },
          passingCandidates: ['.btn'],
        }),
      readSpecSource: async () => null,
    });

    const result = await client.query(
      'SELECT COUNT(*) as c FROM heal_attempts WHERE test_run_id = $1 AND pr_url IS NOT NULL',
      [report.testRunId],
    );

    expect(Number(result.rows[0]?.c ?? 0)).toBe(0);
  } finally {
    await client.end();
  }
});

test('7. no healed row with null proposed_selector', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const model = scriptedModel([
      { toolCalls: [{ name: 'get_dom_snapshot', args: {} }] },
      { toolCalls: [{ name: 'query_selector', args: { selector: '.btn' } }] },
      { toolCalls: [{ name: 'run_single_test', args: { candidate: '.btn' } }] },
    ]);

    const report = await runHeal({
      connectionString: url,
      resultsPath: 'agent/classifier/__fixtures__/broken-run.results.json',
      appUrl: 'http://localhost:3000',
      schema,
      model,
      createToolbox: async () =>
        closableFakeToolbox({
          snapshotHtml: '<html><body><button class="btn">Click</button></body></html>',
          matchCounts: { '.btn': 1 },
          passingCandidates: ['.btn'],
        }),
      readSpecSource: async () => null,
    });

    const result = await client.query(
      "SELECT COUNT(*) as c FROM heal_attempts WHERE test_run_id = $1 AND status = 'healed' AND proposed_selector IS NULL",
      [report.testRunId],
    );

    expect(Number(result.rows[0]?.c ?? 0)).toBe(0);
  } finally {
    await client.end();
  }
});

test('8. two runs create distinct test_runs rows', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const model = scriptedModel([
      { toolCalls: [{ name: 'get_dom_snapshot', args: {} }] },
    ]);

    const createToolbox = async () =>
      closableFakeToolbox({
        snapshotHtml: '<html><body></body></html>',
      });

    const report1 = await runHeal({
      connectionString: url,
      resultsPath: 'agent/classifier/__fixtures__/broken-run.results.json',
      appUrl: 'http://localhost:3000',
      schema,
      model,
      createToolbox,
      readSpecSource: async () => null,
    });

    const report2 = await runHeal({
      connectionString: url,
      resultsPath: 'agent/classifier/__fixtures__/broken-run.results.json',
      appUrl: 'http://localhost:3000',
      schema,
      model,
      createToolbox,
      readSpecSource: async () => null,
    });

    expect(report1.testRunId).not.toBe(report2.testRunId);

    // Check they're both in DB
    const result = await client.query('SELECT COUNT(*) as c FROM test_runs WHERE id IN ($1, $2)', [
      report1.testRunId,
      report2.testRunId,
    ]);

    expect(Number(result.rows[0]?.c ?? 0)).toBe(2);

    // Ensure no shared heal_attempts rows: verify each run's attempts are isolated
    const run1Result = await client.query(
      'SELECT COUNT(*) as c FROM heal_attempts WHERE test_run_id = $1',
      [report1.testRunId],
    );
    const run2Result = await client.query(
      'SELECT COUNT(*) as c FROM heal_attempts WHERE test_run_id = $1',
      [report2.testRunId],
    );

    const run1Count = Number(run1Result.rows[0]?.c ?? 0);
    const run2Count = Number(run2Result.rows[0]?.c ?? 0);

    expect(run1Count).toBeGreaterThan(0);
    expect(run2Count).toBeGreaterThan(0);

    // Verify attempt ids don't overlap
    const overlapResult = await client.query(
      `SELECT COUNT(*) as c FROM heal_attempts ha1
       INNER JOIN heal_attempts ha2 ON ha1.id = ha2.id
       WHERE ha1.test_run_id = $1 AND ha2.test_run_id = $2`,
      [report1.testRunId, report2.testRunId],
    );
    expect(Number(overlapResult.rows[0]?.c ?? 0)).toBe(0);
  } finally {
    await client.end();
  }
});

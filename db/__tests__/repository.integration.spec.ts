import { test, expect } from '@playwright/test';
import { applyMigrations } from '../migrate.js';
import { createDbClient, resolveTestDatabaseUrl } from '../client.js';
import {
  connectRunClient,
  insertTestRun,
  finishTestRun,
  insertHealAttempt,
  settleHealAttempt,
  recordPrUrl,
  toDeliveryFailureSettleInput,
  PersistenceError,
} from '../repository.js';
import { assessHealResult } from '../../agent/loop/confidence.js';
import type { HealResult } from '../../agent/loop/types.js';
import type { VerifiedFixMeasurement } from '../../agent/loop/confidence.js';

const url = resolveTestDatabaseUrl(process.env);

test.skip(url === null, 'MEND_TEST_DATABASE_URL is not set — see db/README.md');

if (url === null) {
  console.log('[db] MEND_TEST_DATABASE_URL not set — repository integration suite skipped');
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

test('1. insertTestRun returns uuid and row is created', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const startedAt = '2025-01-01T00:00:00Z';
    const testRunId = await insertTestRun(client, {
      startedAt,
      total: 10,
      passed: 8,
      failed: 2,
    });

    expect(testRunId).toBeTruthy();
    expect(testRunId).toMatch(/^[0-9a-f-]+$/);

    const result = await client.query(
      'SELECT id, started_at, finished_at, total, passed, failed FROM test_runs WHERE id = $1',
      [testRunId],
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.finished_at).toBeNull();
    expect(row.total).toBe(10);
    expect(row.passed).toBe(8);
    expect(row.failed).toBe(2);
  } finally {
    await client.end();
  }
});

test('2. insertTestRun with passed+failed > total rejects and inserts no row', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const countBefore = await client.query('SELECT COUNT(*) as c FROM test_runs');
    const count1 = Number(countBefore.rows[0]?.c ?? 0);

    let error: unknown;
    try {
      await insertTestRun(client, {
        startedAt: '2025-01-01T00:00:00Z',
        total: 10,
        passed: 6,
        failed: 5, // 6 + 5 = 11 > 10
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(PersistenceError);
    if (error instanceof PersistenceError) {
      expect(error.code).toBe('invariant-violation');
    }

    const countAfter = await client.query('SELECT COUNT(*) as c FROM test_runs');
    const count2 = Number(countAfter.rows[0]?.c ?? 0);
    expect(count2).toBe(count1);
  } finally {
    await client.end();
  }
});

test('3. insertHealAttempt returns uuid with correct defaults', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    expect(attemptId).toBeTruthy();

    const result = await client.query(
      'SELECT id, status, confidence, tool_call_count, proposed_selector, pr_url, transcript FROM heal_attempts WHERE id = $1',
      [attemptId],
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.status).toBe('investigating');
    expect(row.confidence).toBe('none');
    expect(row.tool_call_count).toBe(0);
    expect(row.proposed_selector).toBeNull();
    expect(row.pr_url).toBeNull();
    expect(row.transcript).toEqual({});
  } finally {
    await client.end();
  }
});

test('4. settleHealAttempt healed/high updates row correctly', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    await settleHealAttempt(client, {
      attemptId,
      status: 'healed',
      confidence: 'high',
      proposedSelector: '.btn-primary',
      toolCallCount: 1,
      failureReason: null,
      transcriptJson: '{"test": "data"}',
    });

    const result = await client.query(
      'SELECT status, confidence, proposed_selector, failure_reason, pr_url FROM heal_attempts WHERE id = $1',
      [attemptId],
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.status).toBe('healed');
    expect(row.confidence).toBe('high');
    expect(row.proposed_selector).toBe('.btn-primary');
    expect(row.failure_reason).toBeNull();
    expect(row.pr_url).toBeNull();
  } finally {
    await client.end();
  }
});

test('5. settleHealAttempt needs_review/low persists failure_reason', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    await settleHealAttempt(client, {
      attemptId,
      status: 'needs_review',
      confidence: 'low',
      proposedSelector: '.btn-primary',
      toolCallCount: 3,
      failureReason: 'ambiguous-match,too-many-tool-calls',
      transcriptJson: '{"test": "data"}',
    });

    const result = await client.query(
      'SELECT status, confidence, failure_reason FROM heal_attempts WHERE id = $1',
      [attemptId],
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.status).toBe('needs_review');
    expect(row.confidence).toBe('low');
    expect(row.failure_reason).toBe('ambiguous-match,too-many-tool-calls');
  } finally {
    await client.end();
  }
});

test('6. settleHealAttempt failed/none persists null selector', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    await settleHealAttempt(client, {
      attemptId,
      status: 'failed',
      confidence: 'none',
      proposedSelector: null,
      toolCallCount: 0,
      failureReason: 'no-verified-fix',
      transcriptJson: '{"test": "data"}',
    });

    const result = await client.query(
      'SELECT status, confidence, proposed_selector, failure_reason FROM heal_attempts WHERE id = $1',
      [attemptId],
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.status).toBe('failed');
    expect(row.confidence).toBe('none');
    expect(row.proposed_selector).toBeNull();
    expect(row.failure_reason).toBe('no-verified-fix');
  } finally {
    await client.end();
  }
});

test('7. calling settleHealAttempt twice on same id rejects second call', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    await settleHealAttempt(client, {
      attemptId,
      status: 'healed',
      confidence: 'high',
      proposedSelector: '.btn-primary',
      toolCallCount: 1,
      failureReason: null,
      transcriptJson: '{"test": "data1"}',
    });

    // Second call should fail
    let error: unknown;
    try {
      await settleHealAttempt(client, {
        attemptId,
        status: 'needs_review',
        confidence: 'low',
        proposedSelector: '.btn-secondary',
        toolCallCount: 2,
        failureReason: 'ambiguous-match',
        transcriptJson: '{"test": "data2"}',
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(PersistenceError);
    if (error instanceof PersistenceError) {
      expect(error.code).toBe('not-found');
    }

    // Verify first values are unchanged
    const result = await client.query(
      'SELECT proposed_selector FROM heal_attempts WHERE id = $1',
      [attemptId],
    );
    expect(result.rows[0]?.proposed_selector).toBe('.btn-primary');
  } finally {
    await client.end();
  }
});

test('8. settleHealAttempt with investigating status rejects', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    let error: unknown;
    try {
      await settleHealAttempt(client, {
        attemptId,
        status: 'investigating',
        confidence: 'none',
        proposedSelector: null,
        toolCallCount: 0,
        failureReason: null,
        transcriptJson: '{}',
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(PersistenceError);
    if (error instanceof PersistenceError) {
      expect(error.code).toBe('invariant-violation');
    }
  } finally {
    await client.end();
  }
});

test('9. settleHealAttempt healed/low rejects before SQL', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    let error: unknown;
    try {
      await settleHealAttempt(client, {
        attemptId,
        status: 'healed',
        confidence: 'low',
        proposedSelector: '.btn-primary',
        toolCallCount: 1,
        failureReason: 'test',
        transcriptJson: '{}',
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(PersistenceError);
    if (error instanceof PersistenceError) {
      expect(error.code).toBe('invariant-violation');
    }

    // Verify row is unchanged (still investigating)
    const result = await client.query(
      'SELECT status FROM heal_attempts WHERE id = $1',
      [attemptId],
    );
    expect(result.rows[0]?.status).toBe('investigating');
  } finally {
    await client.end();
  }
});

test('10. settleHealAttempt with toolCallCount > 5 rejects', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    let error: unknown;
    try {
      await settleHealAttempt(client, {
        attemptId,
        status: 'failed',
        confidence: 'none',
        proposedSelector: null,
        toolCallCount: 6,
        failureReason: 'cap-reached',
        transcriptJson: '{}',
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(PersistenceError);
    if (error instanceof PersistenceError) {
      expect(error.code).toBe('invariant-violation');
    }
  } finally {
    await client.end();
  }
});

test('11. finishTestRun sets finished_at and second call rejects', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const startedAt = '2025-01-01T00:00:00Z';
    const finishedAt = '2025-01-01T00:00:10Z';
    const testRunId = await insertTestRun(client, {
      startedAt,
      total: 1,
      passed: 1,
      failed: 0,
    });

    await finishTestRun(client, testRunId, finishedAt);

    const result = await client.query(
      'SELECT started_at, finished_at FROM test_runs WHERE id = $1',
      [testRunId],
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(new Date(row.finished_at).toISOString()).toBe(new Date(finishedAt).toISOString());
    expect(new Date(row.finished_at) >= new Date(row.started_at)).toBe(true);

    // Second call with random uuid should fail
    let error: unknown;
    try {
      await finishTestRun(client, '00000000-0000-0000-0000-000000000000', finishedAt);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(PersistenceError);
    if (error instanceof PersistenceError) {
      expect(error.code).toBe('not-found');
    }
  } finally {
    await client.end();
  }
});

test('12. transcript is queryable with JSONB operators', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    const transcriptJson = JSON.stringify({
      transcript: {
        toolCalls: [{ tool: 'run_single_test' }, { tool: 'query_selector' }],
      },
    });

    await settleHealAttempt(client, {
      attemptId,
      status: 'healed',
      confidence: 'high',
      proposedSelector: '.btn-primary',
      toolCallCount: 2,
      failureReason: null,
      transcriptJson,
    });

    // Query by tool call
    const result1 = await client.query(
      "SELECT id FROM heal_attempts WHERE transcript @> '{\"transcript\":{\"toolCalls\":[{\"tool\":\"run_single_test\"}]}}'::jsonb",
    );
    expect(result1.rows.length).toBeGreaterThan(0);

    // Query tool call count
    const result2 = await client.query(
      "SELECT jsonb_array_length(transcript->'transcript'->'toolCalls') AS n FROM heal_attempts WHERE id = $1",
      [attemptId],
    );
    expect(result2.rows[0]?.n).toBe(2);
  } finally {
    await client.end();
  }
});

test('13. connectRunClient with invalid schema name rejects', async () => {
  if (url === null) {
    return;
  }

  let error: unknown;
  try {
    await connectRunClient(url, 'Bad Name');
  } catch (err) {
    error = err;
  }

  expect(error).toBeInstanceOf(PersistenceError);
  if (error instanceof PersistenceError) {
    expect(error.code).toBe('invalid-schema-name');
  }
});

test('14. recordPrUrl on a settled healed/high attempt sets pr_url', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    await settleHealAttempt(client, {
      attemptId,
      status: 'healed',
      confidence: 'high',
      proposedSelector: '.btn-primary',
      toolCallCount: 1,
      failureReason: null,
      transcriptJson: '{"test": "data"}',
    });

    const prUrl = 'https://github.com/o/r/pull/7';
    await recordPrUrl(client, attemptId, prUrl);

    const result = await client.query(
      'SELECT pr_url FROM heal_attempts WHERE id = $1',
      [attemptId],
    );

    expect(result.rows[0]?.pr_url).toBe(prUrl);
  } finally {
    await client.end();
  }
});

test('15. recordPrUrl called twice for the same attempt rejects second call', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    await settleHealAttempt(client, {
      attemptId,
      status: 'healed',
      confidence: 'high',
      proposedSelector: '.btn-primary',
      toolCallCount: 1,
      failureReason: null,
      transcriptJson: '{"test": "data"}',
    });

    const prUrl1 = 'https://github.com/o/r/pull/7';
    await recordPrUrl(client, attemptId, prUrl1);

    // Second call should fail
    let error: unknown;
    try {
      const prUrl2 = 'https://github.com/o/r/pull/8';
      await recordPrUrl(client, attemptId, prUrl2);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(PersistenceError);
    if (error instanceof PersistenceError) {
      expect(error.code).toBe('not-found');
    }

    // Verify first URL is unchanged
    const result = await client.query(
      'SELECT pr_url FROM heal_attempts WHERE id = $1',
      [attemptId],
    );
    expect(result.rows[0]?.pr_url).toBe(prUrl1);
  } finally {
    await client.end();
  }
});

test('16. recordPrUrl on needs_review/low or failed/none attempt rejects', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 2,
      passed: 0,
      failed: 2,
    });

    // needs_review/low attempt
    const attemptId1 = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work 1',
      originalSelector: '#btn',
    });

    await settleHealAttempt(client, {
      attemptId: attemptId1,
      status: 'needs_review',
      confidence: 'low',
      proposedSelector: '.btn-primary',
      toolCallCount: 3,
      failureReason: 'ambiguous-match',
      transcriptJson: '{"test": "data"}',
    });

    // failed/none attempt
    const attemptId2 = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work 2',
      originalSelector: '#btn2',
    });

    await settleHealAttempt(client, {
      attemptId: attemptId2,
      status: 'failed',
      confidence: 'none',
      proposedSelector: null,
      toolCallCount: 0,
      failureReason: 'no-verified-fix',
      transcriptJson: '{"test": "data"}',
    });

    // Try to record PR URL on needs_review attempt
    let error1: unknown;
    try {
      await recordPrUrl(client, attemptId1, 'https://github.com/o/r/pull/1');
    } catch (err) {
      error1 = err;
    }

    expect(error1).toBeInstanceOf(PersistenceError);
    if (error1 instanceof PersistenceError) {
      expect(error1.code).toBe('not-found');
    }

    // Try to record PR URL on failed attempt
    let error2: unknown;
    try {
      await recordPrUrl(client, attemptId2, 'https://github.com/o/r/pull/2');
    } catch (err) {
      error2 = err;
    }

    expect(error2).toBeInstanceOf(PersistenceError);
    if (error2 instanceof PersistenceError) {
      expect(error2.code).toBe('not-found');
    }

    // Verify both remain NULL
    const result = await client.query(
      'SELECT pr_url FROM heal_attempts WHERE id IN ($1, $2)',
      [attemptId1, attemptId2],
    );
    expect(result.rows.every((r: any) => r.pr_url === null)).toBe(true);
  } finally {
    await client.end();
  }
});

test('17. recordPrUrl with invalid URL rejects and issues no UPDATE', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const attemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    await settleHealAttempt(client, {
      attemptId,
      status: 'healed',
      confidence: 'high',
      proposedSelector: '.btn-primary',
      toolCallCount: 1,
      failureReason: null,
      transcriptJson: '{"test": "data"}',
    });

    // Try with non-https URL
    let error: unknown;
    try {
      await recordPrUrl(client, attemptId, 'ftp://example.com');
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(PersistenceError);
    if (error instanceof PersistenceError) {
      expect(error.code).toBe('invariant-violation');
    }

    // Verify pr_url is unchanged (still NULL)
    const result = await client.query(
      'SELECT pr_url FROM heal_attempts WHERE id = $1',
      [attemptId],
    );
    expect(result.rows[0]?.pr_url).toBeNull();
  } finally {
    await client.end();
  }
});

test('18. toDeliveryFailureSettleInput creates needs_review/low input with fix preserved', async () => {
  if (url === null) {
    return;
  }

  // Create a high-confidence assessment
  const result: HealResult = {
    originalSelector: '#login-btn',
    proposedSelector: '#signin-button',
    specFile: 'tests/login-submit.spec.ts',
    testName: 'submits the login form',
    verified: true,
    verification: {
      candidateSelector: '#signin-button',
      executed: true,
      passed: true,
      rejected: null,
      changedLines: [{ lineNumber: 5, before: 'x', after: 'y' }],
      durationMs: 1234,
      output: 'Test passed',
    },
    outcome: 'healed',
    stopReason: 'verified-fix',
    toolCallCount: 1,
    capReached: false,
    modelTurnCount: 1,
    model: 'gpt-4',
    startedAt: '2024-01-01T00:00:00Z',
    durationMs: 5000,
    errorMessage: null,
    transcript: {
      bootstrapSnapshot: null,
      bootstrapSpecSource: 'source',
      messages: [],
      toolCalls: [
        {
          index: 1,
          toolCallId: 'call1',
          tool: 'get_dom_snapshot',
          rawArguments: '{}',
          arguments: { specFile: 'tests/login-submit.spec.ts' },
          ok: true,
          result: { kind: 'dom-snapshot', url: 'http://localhost', html: '<body></body>', estimatedTokens: 100, elementCount: 0, truncated: false },
          resultSummary: 'found button',
          startedAt: '2024-01-01T00:00:00Z',
          durationMs: 100,
        },
      ],
      modelRequests: [
        { turn: 1, finishReason: 'tool_calls', usage: null, contentPreview: '', requestedTools: [] },
      ],
    },
  };

  const measurement: VerifiedFixMeasurement = {
    selector: result.proposedSelector!,
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: '2024-01-01T00:00:00Z',
    durationMs: 100,
  };

  const assessment = assessHealResult(result, measurement);

  // Create input from delivery failure
  const attemptId = '00000000-0000-0000-0000-000000000000';
  const deliveryError = 'boom';
  const settleInput = toDeliveryFailureSettleInput(attemptId, assessment, deliveryError);

  expect(settleInput.attemptId).toBe(attemptId);
  expect(settleInput.status).toBe('needs_review');
  expect(settleInput.confidence).toBe('low');
  expect(settleInput.proposedSelector).toBe('#signin-button');
  expect(settleInput.toolCallCount).toBe(1);
  expect(settleInput.failureReason).toMatch(/^pr-delivery-failed/);
  expect(settleInput.failureReason).toContain('boom');

  // Verify transcript is unmodified (still says high)
  const transcript = JSON.parse(settleInput.transcriptJson);
  expect(transcript.confidence).toBe('high');
  expect(transcript.prEligible).toBe(true);

  // Test with database: should succeed
  const client = await connectRunClient(url, schema);
  try {
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 1,
      passed: 0,
      failed: 1,
    });

    const dbAttemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/example.spec.ts',
      testName: 'should work',
      originalSelector: '#btn',
    });

    const dbSettleInput = toDeliveryFailureSettleInput(dbAttemptId, assessment, 'test error');
    await settleHealAttempt(client, dbSettleInput);

    const result = await client.query(
      'SELECT status, confidence, proposed_selector FROM heal_attempts WHERE id = $1',
      [dbAttemptId],
    );

    expect(result.rows[0]?.status).toBe('needs_review');
    expect(result.rows[0]?.confidence).toBe('low');
    expect(result.rows[0]?.proposed_selector).not.toBeNull();
  } finally {
    await client.end();
  }
});

test('toDeliveryFailureSettleInput with low assessment throws', async () => {
  // Create a low-confidence assessment (too many tool calls)
  const result: HealResult = {
    originalSelector: '#login-btn',
    proposedSelector: '#signin-button',
    specFile: 'tests/login-submit.spec.ts',
    testName: 'submits the login form',
    verified: true,
    verification: {
      candidateSelector: '#signin-button',
      executed: true,
      passed: true,
      rejected: null,
      changedLines: [{ lineNumber: 5, before: 'x', after: 'y' }],
      durationMs: 1234,
      output: 'Test passed',
    },
    outcome: 'healed',
    stopReason: 'verified-fix',
    toolCallCount: 5, // At cap - will be low confidence
    capReached: false,
    modelTurnCount: 1,
    model: 'gpt-4',
    startedAt: '2024-01-01T00:00:00Z',
    durationMs: 5000,
    errorMessage: null,
    transcript: {
      bootstrapSnapshot: null,
      bootstrapSpecSource: 'source',
      messages: [],
      toolCalls: [
        {
          index: 1,
          toolCallId: 'call1',
          tool: 'get_dom_snapshot',
          rawArguments: '{}',
          arguments: {},
          ok: true,
          result: { kind: 'dom-snapshot', url: 'http://localhost', html: '<body></body>', estimatedTokens: 100, elementCount: 0, truncated: false },
          resultSummary: 'snapshot',
          startedAt: '2024-01-01T00:00:00Z',
          durationMs: 100,
        },
      ],
      modelRequests: [
        { turn: 1, finishReason: 'tool_calls', usage: null, contentPreview: '', requestedTools: [] },
      ],
    },
  };

  const measurement: VerifiedFixMeasurement = {
    selector: result.proposedSelector!,
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: '2024-01-01T00:00:00Z',
    durationMs: 100,
  };

  const assessment = assessHealResult(result, measurement);

  let error: unknown;
  try {
    toDeliveryFailureSettleInput('id', assessment, 'error');
  } catch (err) {
    error = err;
  }

  expect(error).toBeDefined();
  expect(error instanceof Error).toBe(true);
});

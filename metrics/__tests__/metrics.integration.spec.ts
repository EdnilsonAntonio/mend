import { test, expect } from '@playwright/test';
import { applyMigrations } from '../../db/migrate.js';
import { createDbClient, resolveTestDatabaseUrl } from '../../db/client.js';
import {
  connectRunClient,
  insertTestRun,
  insertHealAttempt,
  settleHealAttempt,
  recordPrUrl,
} from '../../db/repository.js';
import type { SettleHealAttemptInput } from '../../db/repository.js';
import { createPgRowReader, loadMetricsRows } from '../query.js';
import { buildMetricsReport } from '../compute.js';
import { rate } from '../compute.js';

const url = resolveTestDatabaseUrl(process.env);

test.skip(url === null, 'MEND_TEST_DATABASE_URL is not set — see db/README.md');

if (url === null) {
  console.log('[metrics] MEND_TEST_DATABASE_URL not set — integration suite skipped');
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

test('integration: load metrics rows and build report', async () => {
  if (url === null) {
    return;
  }

  const client = await connectRunClient(url, schema);
  try {
    // Insert a test run
    const testRunId = await insertTestRun(client, {
      startedAt: '2025-01-01T00:00:00Z',
      total: 3,
      passed: 0,
      failed: 3,
    });

    // Insert healed attempt with PR URL and transcript with model usage
    const healedAttemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/login-submit.spec.ts',
      testName: 'should login',
      originalSelector: '#login-btn',
    });

    const healedSettleInput: SettleHealAttemptInput = {
      attemptId: healedAttemptId,
      status: 'healed',
      confidence: 'high',
      proposedSelector: '#signin-button',
      toolCallCount: 1,
      failureReason: null,
      transcriptJson: JSON.stringify({
        model: 'gpt-4o-mini',
        outcome: 'healed',
        confidence: 'high',
        proposedSelector: '#signin-button',
        truncated: false,
        transcript: {
          toolCalls: [
            {
              index: 1,
              toolCallId: 'call-1',
              tool: 'run_single_test',
              rawArguments: '{"selector": "#signin-button"}',
              arguments: { selector: '#signin-button' },
              ok: true,
              result: {
                kind: 'run-single-test',
                passed: true,
                executed: true,
                candidate: '#signin-button',
                rejected: null,
                violations: [],
                changedLines: [],
                output: '',
              },
              resultSummary: 'passed',
              startedAt: '2025-01-01T00:00:00Z',
              durationMs: 100,
            },
          ],
          modelRequests: [
            {
              turn: 1,
              finishReason: 'tool_calls',
              usage: {
                promptTokens: 1000,
                completionTokens: 2000,
                totalTokens: 3000,
              },
              contentPreview: 'test',
              requestedTools: ['run_single_test'],
            },
          ],
          bootstrapSnapshot: null,
          bootstrapSpecSource: null,
          messages: [],
        },
        verification: {
          candidateSelector: '#signin-button',
          passed: true,
          executed: true,
          rejected: null,
          changedLines: [],
          output: '',
          durationMs: 100,
        },
      }),
    };

    await settleHealAttempt(client, healedSettleInput);
    await recordPrUrl(client, healedAttemptId, 'https://github.com/test/pr/1');

    // Insert needs_review attempt
    const needsReviewAttemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/cart-add.spec.ts',
      testName: 'should add to cart',
      originalSelector: '.add-to-cart',
    });

    const needsReviewSettleInput: SettleHealAttemptInput = {
      attemptId: needsReviewAttemptId,
      status: 'needs_review',
      confidence: 'low',
      proposedSelector: '#product-button',
      toolCallCount: 1,
      failureReason: null,
      transcriptJson: JSON.stringify({
        model: 'gpt-4o-mini',
        outcome: 'needs-review',
        confidence: 'low',
        proposedSelector: '#product-button',
        truncated: false,
        transcript: {
          toolCalls: [
            {
              index: 1,
              toolCallId: 'call-1',
              tool: 'run_single_test',
              rawArguments: '{"selector": "#product-button"}',
              arguments: { selector: '#product-button' },
              ok: true,
              result: {
                kind: 'run-single-test',
                passed: true,
                executed: true,
                candidate: '#product-button',
                rejected: null,
                violations: [],
                changedLines: [],
                output: '',
              },
              resultSummary: 'passed',
              startedAt: '2025-01-01T00:00:00Z',
              durationMs: 100,
            },
          ],
          modelRequests: [],
          bootstrapSnapshot: null,
          bootstrapSpecSource: null,
          messages: [],
        },
        verification: {
          candidateSelector: '#product-button',
          passed: true,
          executed: true,
          rejected: null,
          changedLines: [],
          output: '',
          durationMs: 100,
        },
      }),
    };

    await settleHealAttempt(client, needsReviewSettleInput);

    // Insert failed attempt
    const failedAttemptId = await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/product-price.spec.ts',
      testName: 'should show price',
      originalSelector: '#product-card > .price',
    });

    const failedSettleInput: SettleHealAttemptInput = {
      attemptId: failedAttemptId,
      status: 'failed',
      confidence: 'none',
      proposedSelector: null,
      toolCallCount: 0,
      failureReason: null,
      transcriptJson: JSON.stringify({
        model: null,
        outcome: 'failed',
        confidence: 'none',
        proposedSelector: null,
        truncated: false,
        transcript: {
          toolCalls: [],
          modelRequests: [],
          bootstrapSnapshot: null,
          bootstrapSpecSource: null,
          messages: [],
        },
        verification: null,
      }),
    };

    await settleHealAttempt(client, failedSettleInput);

    // Insert an investigating attempt (no settle)
    await insertHealAttempt(client, {
      testRunId,
      specFile: 'tests/login-validation.spec.ts',
      testName: 'should validate',
      originalSelector: 'button:has-text("Sign In")',
    });

    // Now load metrics rows
    const reader = await createPgRowReader(url, schema);
    try {
      const rows = await loadMetricsRows(reader.read, {
        testRunId,
        since: null,
      });

      // Verify 4 rows loaded, ordered by created_at
      expect(rows).toHaveLength(4);
      expect(rows[0]?.status).toBe('healed');
      expect(rows[1]?.status).toBe('needs_review');
      expect(rows[2]?.status).toBe('failed');
      expect(rows[3]?.status).toBe('investigating');

      // Verify investigating row is mapped correctly
      const invRow = rows[3];
      if (invRow) {
        expect(invRow.verificationPresent).toBe(false);
        expect(invRow.runTestCalls).toHaveLength(0);
        expect(invRow.modelUsages).toHaveLength(0);
      }

      // Verify healed row
      const healedRow = rows[0];
      if (healedRow) {
        expect(healedRow.modelUsages[0]?.promptTokens).toBe(1000);
        const runTestCall = healedRow.runTestCalls.find(
          c => c.candidate === healedRow.proposedSelector
        );
        expect(runTestCall?.passed).toBe(true);
        expect(runTestCall?.executed).toBe(true);
        expect(runTestCall?.violationCount).toBe(0);
        expect(healedRow.verificationPassed).toBe(true);
        expect(healedRow.verificationCandidate).toBe(healedRow.proposedSelector);
      }

      // Build report
      const report = buildMetricsReport(rows, { testRunId, since: null }, '2025-01-01T01:00:00Z');

      // Verify counts
      expect(report.falseFix.falseFixes).toBe(0);
      expect(report.counts.stranded).toBe(1);
      expect(report.counts.settled).toBe(3);

      // Verify heal rate
      expect(report.healRate.healRate).toBe(rate(1, 3, 4));

      // Verify scoping: load with wrong test run id should return empty
      const otherRows = await loadMetricsRows(reader.read, {
        testRunId: 'a0000000-0000-0000-0000-000000000000',
        since: null,
      });
      expect(otherRows).toHaveLength(0);
    } finally {
      await reader.close();
    }
  } finally {
    await client.end();
  }
});

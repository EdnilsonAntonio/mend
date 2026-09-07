import type { ClassifiedFailure } from '../agent/classifier/failure-classifier.js';
import { classifyResultsFile } from '../agent/classifier/failure-classifier.js';
import {
  summariseConfidence,
  type ConfidenceTotals,
  type HealAssessment,
} from '../agent/loop/confidence.js';
import { healQueueSequentially } from '../agent/loop/heal-queue.js';
import type { ClosableToolbox } from '../agent/loop/heal-queue.js';
import type { ModelClient } from '../agent/loop/types.js';
import {
  connectRunClient,
  finishTestRun,
  insertHealAttempt,
  insertTestRun,
  settleHealAttempt,
  toSettleInput,
} from '../db/repository.js';

export interface HealRunOptions {
  readonly connectionString: string;
  /** Repository-relative or absolute path to the Playwright JSON results. */
  readonly resultsPath: string;
  readonly appUrl: string;
  /** When set, only failures whose specFile equals this value are healed. */
  readonly specFilter?: string;
  /** Optional non-default PostgreSQL schema. Test-only. */
  readonly schema?: string;
  readonly model: ModelClient;
  readonly createToolbox: (failure: ClassifiedFailure) => Promise<ClosableToolbox>;
  readonly readSpecSource: (specFile: string) => Promise<string | null>;
  /** One line per event, no trailing newline. Default: no-op. */
  readonly logger?: (line: string) => void;
}

export interface PersistedAttempt {
  readonly attemptId: string;
  readonly specFile: string;
  readonly testName: string;
  /** 'investigating' means the attempt was stranded — see runner/README.md. */
  readonly status: 'investigating' | 'healed' | 'needs_review' | 'failed';
  readonly confidence: 'high' | 'low' | 'none';
  readonly proposedSelector: string | null;
  readonly toolCallCount: number;
  readonly prEligible: boolean;
  /** Non-null only when status is 'investigating'. */
  readonly error: string | null;
}

export interface HealRunReport {
  readonly testRunId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  /** Non-selector-drift failures. Counted, never persisted. */
  readonly skipped: number;
  /** One entry per queued failure, in queue order. */
  readonly attempts: readonly PersistedAttempt[];
  /** Over the attempts that settled. */
  readonly totals: ConfidenceTotals;
}

export async function runHeal(options: HealRunOptions): Promise<HealRunReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // Classify failures from the results file
  const report = await classifyResultsFile(options.resultsPath);

  // Filter if specFilter is set
  const queue = options.specFilter === undefined
    ? report.healQueue
    : report.healQueue.filter((f) => f.specFile === options.specFilter);

  // Connect to database
  const client = await connectRunClient(options.connectionString, options.schema);

  try {
    // Insert the test run
    const testRunId = await insertTestRun(client, {
      startedAt,
      total: report.totalTests,
      passed: report.totalTests - report.failedTests,
      failed: report.failedTests,
    });

    const log = options.logger ?? (() => {});
    log(`run ${testRunId} total=${report.totalTests} passed=${report.totalTests - report.failedTests} failed=${report.failedTests} queued=${queue.length} skipped=${report.skipped.length}`);

    const attempts: PersistedAttempt[] = [];
    const settledAssessments: HealAssessment[] = [];

    // Process each failure
    for (const failure of queue) {
      // Insert the attempt in 'investigating' state
      const attemptId = await insertHealAttempt(client, {
        testRunId,
        specFile: failure.specFile,
        testName: failure.testName,
        originalSelector: failure.selector ?? '',
      });

      log(`[attempt] ${attemptId} spec=${failure.specFile} status=investigating`);

      try {
        // Run the heal loop on this single failure
        const queueResult = await healQueueSequentially([failure], {
          model: options.model,
          appUrl: options.appUrl,
          createToolbox: options.createToolbox,
          readSpecSource: options.readSpecSource,
        });

        const assessment = queueResult.assessments[0];
        if (!assessment) {
          throw new Error('heal queue returned no assessment');
        }

        // Settle the attempt
        await settleHealAttempt(client, toSettleInput(attemptId, assessment));

        // Record in the report
        attempts.push({
          attemptId,
          specFile: failure.specFile,
          testName: failure.testName,
          status: assessment.status,
          confidence: assessment.confidence,
          proposedSelector: assessment.result.proposedSelector,
          toolCallCount: assessment.result.toolCallCount,
          prEligible: assessment.prEligible,
          error: null,
        });

        const proposedDisplay = assessment.result.proposedSelector ?? '-';
        log(`[settled] ${attemptId} spec=${failure.specFile} status=${assessment.status} confidence=${assessment.confidence} proposed=${proposedDisplay} toolCalls=${assessment.result.toolCallCount} prEligible=${assessment.prEligible}`);

        settledAssessments.push(assessment);
      } catch (error) {
        // Stranded attempt — do not attempt to update, leave as investigating
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`[stranded] ${attemptId} spec=${failure.specFile} error=${errorMessage}`);

        attempts.push({
          attemptId,
          specFile: failure.specFile,
          testName: failure.testName,
          status: 'investigating',
          confidence: 'none',
          proposedSelector: null,
          toolCallCount: 0,
          prEligible: false,
          error: errorMessage,
        });
      }
    }

    // Finish the run
    const finishedAt = new Date().toISOString();
    await finishTestRun(client, testRunId, finishedAt);

    // Summarize confidence over settled attempts only
    const totals = summariseConfidence(settledAssessments);

    return {
      testRunId,
      startedAt,
      finishedAt,
      durationMs: Date.now() - t0,
      total: report.totalTests,
      passed: report.totalTests - report.failedTests,
      failed: report.failedTests,
      skipped: report.skipped.length,
      attempts,
      totals,
    };
  } finally {
    await client.end();
  }
}

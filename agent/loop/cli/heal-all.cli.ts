import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { classifyResultsFile } from '../../classifier/failure-classifier.js';
import { summariseConfidence } from '../confidence.js';
import type { ConfidenceTotals, HealAssessment } from '../confidence.js';
import { createOpenAIClient } from '../openai-client.js';
import { createPlaywrightToolbox, DEFAULT_APP_URL } from '../playwright-toolbox.js';
import {
  checkElementIdentity,
  evaluateRun,
  evaluateScenario,
  SCENARIO_EXPECTATIONS,
  summariseMatrix,
} from '../scenario-matrix.js';
import { healQueueSequentially, readSpecSourceFromDisk } from '../heal-queue.js';
import type { RunVerdict, MatrixVerdict } from '../scenario-matrix.js';

export const MAX_MATRIX_RUNS = 5;

interface MatrixReport extends MatrixVerdict {
  readonly confidenceTotals: ConfidenceTotals;
}

const DEFAULT_RESULTS_PATH = 'test-results/results.json';

interface Args {
  runs: number;
  results: string;
  url: string;
  spec?: string;
  jsonOut?: string;
  json: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    runs: 1,
    results: DEFAULT_RESULTS_PATH,
    url: DEFAULT_APP_URL,
    json: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--runs=')) {
      const runsStr = arg.slice(7);
      const runsNum = parseInt(runsStr, 10);
      if (isNaN(runsNum) || runsNum < 1 || runsNum > MAX_MATRIX_RUNS) {
        return { ...args, runs: -1 }; // Signal error
      }
      args.runs = runsNum;
    } else if (arg.startsWith('--results=')) {
      args.results = arg.slice(10);
    } else if (arg.startsWith('--url=')) {
      args.url = arg.slice(6);
    } else if (arg.startsWith('--spec=')) {
      args.spec = arg.slice(7);
    } else if (arg.startsWith('--json-out=')) {
      args.jsonOut = arg.slice(11);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg.startsWith('--') || arg.startsWith('-')) {
      // Unknown flag
      return { ...args, runs: -1 }; // Signal error
    } else {
      // Positional argument
      return { ...args, runs: -1 }; // Signal error
    }
  }

  return args;
}

function usage(): void {
  const usageText = `Usage: npx tsx agent/loop/cli/heal-all.cli.ts [--runs=<n>] [--results=<path>] [--url=<url>] [--spec=<path>] [--json-out=<path>] [--json]
   or: npm run --silent heal:all -- [--runs=<n>] [--results=<path>] [--url=<url>] [--spec=<path>] [--json-out=<path>] [--json]`;
  process.stderr.write(usageText + '\n');
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Validate runs parameter
  if (args.runs < 1 || args.runs > MAX_MATRIX_RUNS) {
    usage();
    process.exit(2);
  }

  // Read and classify results file
  let report;
  try {
    report = await classifyResultsFile(args.results);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error reading results file: ${msg}\n`);
    process.exit(1);
  }

  // Filter failures by spec if --spec was provided
  let failures = report.healQueue;
  if (args.spec !== undefined) {
    failures = failures.filter((f) => f.specFile === args.spec);
  }

  if (failures.length === 0) {
    const spec = args.spec !== undefined ? ` matching ${args.spec}` : '';
    process.stderr.write(
      `no selector-drift failures to heal in ${args.results}${spec} (heal queue: ${report.healQueue.length} entries)\n`,
    );
    process.exit(1);
  }

  // Create OpenAI client
  let client;
  try {
    client = createOpenAIClient();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }

  // Determine expected spec files
  const expectedSpecFiles =
    args.spec !== undefined
      ? [args.spec]
      : SCENARIO_EXPECTATIONS.map((e) => e.specFile);

  // Run the matrix
  const matrixStartedAt = new Date().toISOString();
  const matrixT0 = Date.now();
  const runVerdicts: RunVerdict[] = [];
  const allAssessments: HealAssessment[] = [];

  for (let run = 1; run <= args.runs; run++) {
    const runStartedAt = new Date().toISOString();
    const runT = Date.now();

    // Heal the queue
    const queueResult = await healQueueSequentially(failures, {
      model: client,
      appUrl: args.url,
      createToolbox: (failure) => createPlaywrightToolbox(failure, { appUrl: args.url }),
      readSpecSource: readSpecSourceFromDisk,
    });
    allAssessments.push(...queueResult.assessments);

    // Identity checks: launch one browser and page
    const identities: (string | null)[] = [];
    let browser;
    try {
      browser = await chromium.launch();
      const page = await browser.newPage();
      try {
        await page.goto(args.url);

        for (const result of queueResult.results) {
          if (result.proposedSelector === null) {
            identities.push(null);
          } else {
            const expectation = SCENARIO_EXPECTATIONS.find(
              (e) => e.specFile === result.specFile,
            );
            const oracleSelector = expectation?.oracleSelector ?? null;
            const identity = await checkElementIdentity(
              page,
              result.proposedSelector,
              oracleSelector,
            );
            identities.push(identity);
          }
        }
      } finally {
        await page.close();
      }
    } catch {
      // Browser launch or navigation failed; record check-error for all results
      for (const _ of queueResult.results) {
        identities.push('check-error');
      }
    } finally {
      if (browser !== undefined) {
        await browser.close();
      }
    }

    // Build scenario verdicts
    const scenarios = queueResult.results.map((r, i) =>
      evaluateScenario(r, identities[i] as any),
    );

    // Evaluate the run
    const runVerdict = evaluateRun(run, runStartedAt, Date.now() - runT, scenarios, expectedSpecFiles);
    runVerdicts.push(runVerdict);

    // Print per-scenario lines for this run (only in default mode, not --json)
    if (!args.json) {
      for (const [i, scenario] of scenarios.entries()) {
        const proposedStr = scenario.proposedSelector ?? '-';
        const identityStr = scenario.identity ?? '-';
        const reasonsStr =
          scenario.failureReasons.length > 0
            ? scenario.failureReasons.join(',')
            : '-';
        const verdictStr = scenario.pass ? 'PASS' : 'FAIL';
        const a = queueResult.assessments[i];

        process.stdout.write(
          `run=${run}/${args.runs} scenario=${scenario.scenario} spec=${scenario.specFile} required=${scenario.requiredOutcome} outcome=${scenario.outcome} stopReason=${scenario.stopReason} proposed=${proposedStr} toolCalls=${scenario.toolCallCount}/5 identity=${identityStr} verdict=${verdictStr} reasons=${reasonsStr} confidence=${a?.confidence ?? '-'} status=${a?.status ?? '-'} prEligible=${a?.prEligible ?? false} matchCount=${a?.measurement?.matchCount ?? '-'}\n`,
        );
      }
    }
  }

  // Summarize the matrix
  const matrix = summariseMatrix(
    matrixStartedAt,
    Date.now() - matrixT0,
    client.model,
    runVerdicts,
  );

  const confidenceTotals = summariseConfidence(allAssessments);
  const matrixReport: MatrixReport = { ...matrix, confidenceTotals };

  // Print output
  if (args.json) {
    console.log(JSON.stringify(matrixReport, null, 2));
  } else {
    // Print per-scenario summary lines
    for (const summary of matrix.perScenario) {
      const verdictStr = summary.pass ? 'PASS' : 'FAIL';
      process.stdout.write(
        `scenario=${summary.scenario} spec=${summary.specFile} attempts=${summary.attempts} healed=${summary.healed} noFix=${summary.noFix} errors=${summary.errors} wrongElement=${summary.wrongElement} passes=${summary.passes} avgToolCalls=${summary.averageToolCalls} verdict=${verdictStr}\n`,
      );
    }

    // Print confidence totals line
    process.stdout.write(
      `confidence attempts=${confidenceTotals.attempts} high=${confidenceTotals.high} low=${confidenceTotals.low} none=${confidenceTotals.none} prEligible=${confidenceTotals.prEligible}\n`,
    );

    // Print final matrix line
    const finalStr = matrix.pass ? 'true' : 'false';
    process.stdout.write(
      `matrix runs=${matrix.runs} scenarios=${matrix.perScenario.length} model=${matrix.model} durationMs=${matrix.durationMs} pass=${finalStr}\n`,
    );
  }

  // Write JSON output if requested
  if (args.jsonOut !== undefined) {
    try {
      await mkdir(dirname(args.jsonOut), { recursive: true });
      await writeFile(args.jsonOut, JSON.stringify(matrixReport, null, 2), 'utf8');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to write JSON output: ${msg}\n`);
      process.exit(1);
    }
  }

  // Exit with appropriate code
  process.exit(matrix.pass ? 0 : 3);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal error: ${msg}\n`);
  process.exit(1);
});

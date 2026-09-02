import { classifyResultsFile } from '../../classifier/failure-classifier.js';
import { createOpenAIClient } from '../openai-client.js';
import { createPlaywrightToolbox, DEFAULT_APP_URL } from '../playwright-toolbox.js';
import { healFailure, MAX_TOOL_CALLS } from '../heal-loop.js';
import { readSpecSourceFromDisk } from '../heal-queue.js';

const DEFAULT_RESULTS_PATH = 'test-results/results.json';

interface Args {
  spec?: string;
  results: string;
  url: string;
  json: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    results: DEFAULT_RESULTS_PATH,
    url: DEFAULT_APP_URL,
    json: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--spec=')) {
      args.spec = arg.slice(7);
    } else if (arg.startsWith('--results=')) {
      args.results = arg.slice(10);
    } else if (arg.startsWith('--url=')) {
      args.url = arg.slice(6);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg.startsWith('--') || arg.startsWith('-')) {
      // Unknown flag
      usage();
      process.exit(2);
    } else {
      // Positional argument
      usage();
      process.exit(2);
    }
  }

  return args;
}

function usage(): void {
  const usageText = `Usage: npx tsx agent/loop/cli/heal.cli.ts --spec=<path> [--results=<path>] [--url=<url>] [--json]
   or: npm run --silent heal:one -- --spec=<path> [--results=<path>] [--url=<url>] [--json]`;
  process.stderr.write(usageText + '\n');
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.spec || args.spec.trim() === '') {
    usage();
    process.exit(2);
  }

  let report;
  try {
    report = await classifyResultsFile(args.results);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error reading results file: ${msg}\n`);
    process.exit(1);
  }

  const failure = report.healQueue.find((f) => f.specFile === args.spec);
  if (!failure) {
    process.stderr.write(
      `no selector-drift failure for ${args.spec} in ${args.results} (heal queue: ${report.healQueue.length} entries)\n`,
    );
    process.exit(1);
  }

  let client;
  try {
    client = createOpenAIClient();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }

  let toolbox;
  try {
    toolbox = await createPlaywrightToolbox(failure, { appUrl: args.url });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Failed to connect to app at ${args.url}: ${msg}\nMake sure the app is running (npm run start:app)\n`,
    );
    process.exit(1);
  }

  const specSource = await readSpecSourceFromDisk(failure.specFile);

  let result;
  try {
    result = await healFailure(failure, {
      model: client,
      toolbox,
      appUrl: args.url,
      specSource,
    });
  } finally {
    await toolbox.close();
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Print one-liner summary
    const proposedStr = result.proposedSelector ?? '-';
    process.stdout.write(
      `spec=${result.specFile} test=${result.testName} original=${result.originalSelector}\n`,
    );
    process.stdout.write(
      `outcome=${result.outcome} stopReason=${result.stopReason} verified=${result.verified} proposed=${proposedStr} toolCalls=${result.toolCallCount}/${MAX_TOOL_CALLS} capReached=${result.capReached} modelTurns=${result.modelTurnCount} model=${result.model} durationMs=${result.durationMs}\n`,
    );

    // Print each tool call
    for (const tc of result.transcript.toolCalls) {
      const resultSummary =
        tc.resultSummary.length > 200
          ? tc.resultSummary.slice(0, 200)
          : tc.resultSummary;
      process.stdout.write(
        `[${tc.index}] ${tc.tool} ok=${tc.ok} args=${tc.rawArguments} -> ${resultSummary}\n`,
      );
    }

    // Print error if present
    if (result.errorMessage !== null) {
      process.stdout.write(`error: ${result.errorMessage}\n`);
    }
  }

  process.exit(result.outcome === 'healed' ? 0 : 3);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal error: ${msg}\n`);
  process.exit(1);
});

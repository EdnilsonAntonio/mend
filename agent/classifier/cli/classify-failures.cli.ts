import { classifyResultsFile } from '../failure-classifier.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let resultsPath: string | undefined;
  let outputJson = false;
  let error = false;

  for (const arg of args) {
    if (arg === '--json') {
      outputJson = true;
    } else if (arg.startsWith('--results=')) {
      resultsPath = arg.slice('--results='.length);
    } else if (arg.startsWith('-') || arg.startsWith('--')) {
      error = true;
      break;
    } else {
      // Positional argument
      error = true;
      break;
    }
  }

  if (error) {
    const usage = [
      'Usage: npx tsx agent/classifier/cli/classify-failures.cli.ts [--results=<path>] [--json]',
      '   or: npm run --silent classify:failures -- [--results=<path>] [--json]',
    ];
    console.error(usage.join('\n'));
    process.exit(2);
  }

  let report;
  try {
    report = await classifyResultsFile(resultsPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }

  if (outputJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    // Print summary line
    const summaryLine = `total=${report.totalTests} failed=${report.failedTests} heal-queue=${report.healQueue.length} skipped=${report.skipped.length}`;
    console.log(summaryLine);

    // Print heal queue
    for (const failure of report.healQueue) {
      const selector = failure.selector ?? '-';
      const line = `[heal] rule=${failure.rule} selector=${selector} spec=${failure.specFile} test=${failure.testName}`;
      console.log(line);
    }

    // Print skipped
    for (const failure of report.skipped) {
      const selector = failure.selector ?? '-';
      const line = `[skip] rule=${failure.rule} selector=${selector} spec=${failure.specFile} test=${failure.testName}`;
      console.log(line);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

import { runSingleTest } from '../run-single-test.js';

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');

  const spec = readFlag('spec');
  const test = readFlag('test');
  const original = readFlag('original');
  const candidate = readFlag('candidate');

  // Validate arguments
  if (
    spec === undefined ||
    spec === '' ||
    test === undefined ||
    test === '' ||
    original === undefined ||
    original === '' ||
    candidate === undefined ||
    candidate === ''
  ) {
    const usageLine1 =
      'Usage: npx tsx agent/tools/cli/run-single-test.cli.ts --spec=<path> --test=<title> --original=<selector> --candidate=<selector> [--json]';
    const usageLine2 =
      '   or: npm run --silent tool:run-single-test -- --spec=<path> --test=<title> --original=<selector> --candidate=<selector> [--json]';
    console.error(usageLine1);
    console.error(usageLine2);
    process.exit(2);
  }

  try {
    const result = await runSingleTest({
      specFile: spec,
      testName: test,
      originalSelector: original,
      candidateSelector: candidate,
    });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Print header line
      const rejectedStr = result.rejected ?? 'none';
      const exitCodeStr = result.exitCode ?? '-';
      console.log(
        `spec=${result.specFile} test=${result.testName} original=${result.originalSelector} candidate=${result.candidateSelector}`,
      );
      console.log(
        `passed=${result.passed} executed=${result.executed} rejected=${rejectedStr} exitCode=${exitCodeStr} timedOut=${result.timedOut} durationMs=${result.durationMs}`,
      );

      // Print violations
      for (const v of result.violations) {
        console.log(`violation: ${v.rule} ${v.detail}`);
      }

      // Print output
      if (result.output.length > 0) {
        console.log('--- test output ---');
        console.log(result.output);
      }
    }

    // Exit code based on passed status (Q2)
    process.exit(result.passed ? 0 : 3);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`run_single_test failed: ${message}`);
    process.exit(1);
  }
}

main();

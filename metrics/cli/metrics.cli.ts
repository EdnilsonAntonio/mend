import { resolveDatabaseUrl } from '../../db/client.js';
import {
  createPgRowReader,
  loadMetricsRows,
} from '../query.js';
import { buildMetricsReport } from '../compute.js';
import { formatMetricsReport } from '../format.js';
import type { MetricsScope } from '../types.js';

interface Args {
  run: string | null;
  since: string | null;
  json: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    run: null,
    since: null,
    json: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--run=')) {
      args.run = arg.slice('--run='.length);
    } else if (arg.startsWith('--since=')) {
      args.since = arg.slice('--since='.length);
    } else if (arg === '--json') {
      args.json = true;
    } else {
      // Unknown flag or positional argument - signal error
      return { run: '', since: '', json: false };
    }
  }

  return args;
}

function usage(): void {
  const usageText = `Usage: npx tsx metrics/cli/metrics.cli.ts [--run=<uuid>] [--since=<iso8601>] [--json]
   or: npm run --silent metrics -- [--run=<uuid>] [--since=<iso8601>] [--json]`;
  process.stderr.write(usageText + '\n');
}

async function main(): Promise<void> {
  const argsInput = parseArgs();

  // Check for parse errors (empty string signals error)
  if (argsInput.run === '') {
    usage();
    process.exit(2);
  }

  let run: string | null = argsInput.run;
  let since: string | null = argsInput.since;

  // Validate UUID format if provided
  if (run !== null) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(run)) {
      usage();
      process.exit(2);
    }
  }

  // Validate and normalise ISO8601 date if provided
  if (since !== null) {
    const timestamp = Date.parse(since);
    if (!Number.isFinite(timestamp)) {
      usage();
      process.exit(2);
    }
    since = new Date(since).toISOString();
  }

  // Resolve database URL
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    process.stderr.write('DATABASE_URL is not set; export it before running npm run metrics\n');
    process.exit(1);
  }

  // Create row reader and load metrics
  const scope: MetricsScope = {
    testRunId: run,
    since,
  };

  let reader;
  try {
    reader = await createPgRowReader(connectionString);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  let rows;
  let report;
  try {
    rows = await loadMetricsRows(reader.read, scope);
    report = buildMetricsReport(rows, scope, new Date().toISOString());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  } finally {
    await reader.close();
  }

  // Output results
  if (argsInput.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatMetricsReport(report));
  }

  // Exit with code 5 if false fixes detected, else 0
  if (report.falseFix.falseFixes > 0) {
    process.exit(5);
  } else {
    process.exit(0);
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
});

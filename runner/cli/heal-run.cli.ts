import { resolveDatabaseUrl } from '../../db/client.js';
import { createOpenAIClient } from '../../agent/loop/openai-client.js';
import {
  createPlaywrightToolbox,
  DEFAULT_APP_URL,
} from '../../agent/loop/playwright-toolbox.js';
import { readSpecSourceFromDisk } from '../../agent/loop/heal-queue.js';
import { runHeal } from '../heal-run.js';
import {
  createOctokitApi,
  createPullRequestOpener,
  readSpecFileFromDisk,
  resolveGitHubConfig,
  type GitHubConfig,
} from '../github-pr.js';
import type { PullRequestOpener } from '../github-pr.js';

interface Args {
  results: string;
  url: string;
  spec?: string;
  json: boolean;
  base?: string;
  noPr: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    results: 'test-results/results.json',
    url: DEFAULT_APP_URL,
    json: false,
    noPr: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--results=')) {
      args.results = arg.slice('--results='.length);
    } else if (arg.startsWith('--url=')) {
      args.url = arg.slice('--url='.length);
    } else if (arg.startsWith('--spec=')) {
      args.spec = arg.slice('--spec='.length);
    } else if (arg.startsWith('--base=')) {
      args.base = arg.slice('--base='.length);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--no-pr') {
      args.noPr = true;
    } else if (arg.startsWith('-') || arg.startsWith('--')) {
      // Unknown flag
      return { ...args, results: '', url: '' }; // Signal error
    } else {
      // Positional argument
      return { ...args, results: '', url: '' }; // Signal error
    }
  }

  return args;
}

function usage(): void {
  const usageText = `Usage: npx tsx runner/cli/heal-run.cli.ts [--results=<path>] [--url=<url>] [--spec=<path>] [--base=<branch>] [--json] [--no-pr]
   or: npm run --silent heal -- [--results=<path>] [--url=<url>] [--spec=<path>] [--base=<branch>] [--json] [--no-pr]`;
  process.stderr.write(usageText + '\n');
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Check for parse errors
  if (args.results === '') {
    usage();
    process.exit(2);
  }

  // Check DATABASE_URL
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    process.stderr.write('DATABASE_URL is not set; export it before running npm run heal\n');
    process.exit(1);
  }

  // Create OpenAI client
  let model;
  try {
    model = createOpenAIClient();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }

  // GitHub PR configuration
  let openPullRequest: PullRequestOpener | undefined;
  if (!args.noPr) {
    let config: GitHubConfig | null = null;
    try {
      config = resolveGitHubConfig(process.env);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
    if (config === null) {
      if (!args.json) {
        process.stdout.write('[pr] disabled: GITHUB_TOKEN is not set\n');
      }
    } else {
      const effective = args.base === undefined ? config : { ...config, baseBranch: args.base };
      openPullRequest = createPullRequestOpener({
        config: effective,
        api: createOctokitApi(effective),
        readSpecFile: readSpecFileFromDisk,
        ...(args.json ? {} : { logger: (line: string) => process.stdout.write(line + '\n') }),
      });
    }
  }

  // Run heal
  let report;
  try {
    report = await runHeal({
      connectionString,
      resultsPath: args.results,
      appUrl: args.url,
      specFilter: args.spec,
      model,
      createToolbox: (failure) =>
        createPlaywrightToolbox(failure, { appUrl: args.url }),
      readSpecSource: readSpecSourceFromDisk,
      logger: args.json ? undefined : (line) => process.stdout.write(line + '\n'),
      ...(openPullRequest === undefined ? {} : { openPullRequest }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  // Output results
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const healed = report.attempts.filter((a) => a.status === 'healed').length;
    const needs_review = report.attempts.filter((a) => a.status === 'needs_review').length;
    const failed = report.attempts.filter((a) => a.status === 'failed').length;
    const investigating = report.attempts.filter((a) => a.status === 'investigating').length;

    console.log(
      `heal ok: run=${report.testRunId} attempts=${report.attempts.length} healed=${healed} needs_review=${needs_review} failed=${failed} investigating=${investigating} prs=${report.prsOpened} (${report.durationMs}ms)`,
    );
  }

  // Exit with appropriate code
  const hasInvestigating = report.attempts.some((a) => a.status === 'investigating');
  if (hasInvestigating) {
    process.exit(3);
  }
  if (report.prFailures > 0) {
    process.exit(4);
  }
  process.exit(0);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Unexpected error: ${msg}\n`);
  process.exit(1);
});

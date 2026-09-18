import { applyMigrations, getMigrationStatus } from '../migrate.js';
import { resolveDatabaseUrl } from '../client.js';
import { describeError } from '../connection-errors.js';

function fail(message: string, exitCode = 1): void {
  const text = message.trim().length > 0
    ? message
    : 'Migration failed, but the error carried no message. Re-run with DATABASE_URL set to a reachable Postgres instance.';
  console.error(text);
  process.exitCode = exitCode;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let statusOnly = false;
  let outputJson = false;
  let schema: string | undefined;
  let error = false;

  for (const arg of args) {
    if (arg === '--status') {
      statusOnly = true;
    } else if (arg === '--json') {
      outputJson = true;
    } else if (arg.startsWith('--schema=')) {
      schema = arg.slice('--schema='.length);
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
      'Usage: tsx db/cli/migrate.cli.ts [--status] [--json] [--schema=<name>]',
      '   or: npm run db:migrate -- [--status] [--json] [--schema=<name>]',
    ];
    console.error(usage.join('\n'));
    process.exitCode = 2;
    return;
  }

  // Resolve database URL.
  const connectionString = resolveDatabaseUrl();
  if (!connectionString) {
    fail('DATABASE_URL is not set; export it before running migrations');
    return;
  }

  try {
    if (statusOnly) {
      // Get migration status (read-only).
      const status = await getMigrationStatus({
        connectionString,
        schema,
      });

      if (outputJson) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        // Human-readable status output
        const plan = status.plan;
        console.log(`schema=${status.schema} applied=${plan.applied.length} pending=${plan.pending.length}`);

        // Print applied migrations
        for (const migration of plan.applied) {
          const appliedAt = new Date(migration.appliedAt).toISOString();
          console.log(`[applied] ${migration.version}_${migration.name} ${appliedAt}`);
        }

        // Print pending migrations
        for (const migration of plan.pending) {
          console.log(`[pending] ${migration.version}_${migration.name}`);
        }
      }
    } else {
      // Apply migrations.
      // First, get the status to know how many migrations are pending.
      const status = await getMigrationStatus({
        connectionString,
        schema,
      });

      const pendingCount = status.plan.pending.length;

      if (outputJson) {
        const report = await applyMigrations({
          connectionString,
          schema,
        });
        console.log(JSON.stringify(report, null, 2));
      } else {
        // Human-readable apply output: buffer logger output so we can print header first.
        const loggedLines: string[] = [];
        const logger = (line: string) => loggedLines.push(line);
        const report = await applyMigrations({
          connectionString,
          schema,
          logger,
        });

        const headerLine = `schema=${report.schema} server=${report.serverVersionNum} pending=${pendingCount}`;
        console.log(headerLine);

        // Print all buffered [apply] lines.
        for (const line of loggedLines) {
          console.log(line);
        }

        const appliedCount = report.newlyApplied.length;
        const skippedCount = report.alreadyApplied.length;
        const summaryLine = `migrate ok: applied=${appliedCount} skipped=${skippedCount} pending=0 (${report.durationMs}ms)`;
        console.log(summaryLine);

        const summaryLineExtended = appliedCount === 0
          ? `Applied 0 migrations to schema "${report.schema}" — already up to date (${skippedCount} already applied, ${report.durationMs}ms).`
          : `Applied ${appliedCount} migration${appliedCount === 1 ? '' : 's'} to schema "${report.schema}" (${skippedCount} already applied, ${report.durationMs}ms).`;
        console.log(summaryLineExtended);
      }
    }
  } catch (err) {
    fail(describeError(err));
    return;
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${describeError(err)}`);
  process.exitCode = 1;
});

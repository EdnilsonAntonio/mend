import {
  MigrationError,
  MIGRATIONS_DIR,
  loadMigrationFiles,
  computeMigrationPlan,
  type AppliedMigration,
  type MigrationPlan,
} from './migration-files.js';
import {
  DEFAULT_MIGRATION_SCHEMA,
  MIGRATION_ADVISORY_LOCK_ID,
  applySearchPath,
  assertSupportedServerVersion,
  createDbClient,
} from './client.js';

export interface MigrateOptions {
  readonly connectionString: string;
  /** Default DEFAULT_MIGRATION_SCHEMA. Must satisfy isValidSchemaName. */
  readonly schema?: string;
  /** Default MIGRATIONS_DIR. */
  readonly migrationsDir?: string;
  /** Called once per applied migration, in order. Default: no-op. */
  readonly logger?: (line: string) => void;
}

export interface AppliedMigrationResult {
  readonly version: string;
  readonly fileName: string;
  readonly durationMs: number;
}

export interface MigrateReport {
  readonly schema: string;
  readonly serverVersionNum: number;
  /** Versions already in the ledger before this run, ascending. */
  readonly alreadyApplied: readonly string[];
  /** Applied by this run, in execution order. */
  readonly newlyApplied: readonly AppliedMigrationResult[];
  /** Always [] when applyMigrations resolves. */
  readonly pendingAfter: readonly string[];
  readonly missingFiles: readonly string[];
  readonly durationMs: number;
}

export interface MigrationStatus {
  readonly schema: string;
  readonly plan: MigrationPlan;
}

export const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version      text        NOT NULL PRIMARY KEY,
  name         text        NOT NULL,
  checksum     text        NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  execution_ms integer     NOT NULL
);
`.trim();

const log = (logger: ((line: string) => void) | undefined, msg: string) => {
  if (logger) {
    logger(msg);
  }
};

export async function applyMigrations(options: MigrateOptions): Promise<MigrateReport> {
  const startTime = Date.now();
  const schema = options.schema ?? DEFAULT_MIGRATION_SCHEMA;
  const migrationsDir = options.migrationsDir ?? MIGRATIONS_DIR;
  const logger = options.logger;

  // Step 1: Resolve connection string.
  if (!options.connectionString || options.connectionString.trim() === '') {
    throw new MigrationError('missing-connection-string', 'Connection string is empty');
  }

  // Step 2: Load migration files before connecting.
  const files = await loadMigrationFiles(migrationsDir);

  // Step 3: Create client and ensure cleanup.
  const client = createDbClient(options.connectionString);
  let serverVersionNum: number;

  try {
    await client.connect();

    // Step 4: Assert server version.
    serverVersionNum = await assertSupportedServerVersion(client);

    // Step 5: Apply search path to set schema.
    await applySearchPath(client, schema);

    // Step 6: Acquire advisory lock (and release in finally).
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);

    try {
      // Step 7: Create schema_migrations table.
      await client.query(SCHEMA_MIGRATIONS_DDL);

      // Step 8: Load applied migrations from ledger.
      const ledgerResult = await client.query<{
        version: string;
        name: string;
        checksum: string;
        applied_at: string;
      }>('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC');

      const applied: AppliedMigration[] = ledgerResult.rows.map(row => ({
        version: row.version,
        name: row.name,
        checksum: row.checksum,
        appliedAt: row.applied_at,
      }));

      // Step 9: Compute migration plan.
      const plan = computeMigrationPlan(files, applied);

      if (plan.checksumMismatches.length > 0) {
        const mismatchDescriptions = plan.checksumMismatches
          .map(m => `${m.fileName} (recorded: ${m.recordedChecksum}, actual: ${m.actualChecksum})`)
          .join('; ');
        throw new MigrationError(
          'checksum-mismatch',
          `Checksum mismatches detected: ${mismatchDescriptions}`,
        );
      }

      // Step 10: Apply pending migrations in order.
      const newlyApplied: AppliedMigrationResult[] = [];

      for (const file of plan.pending) {
        const migrationStartTime = Date.now();

        try {
          // Begin transaction.
          await client.query('BEGIN');

          // Execute the migration SQL (no parameters, no parameter array).
          await client.query(file.sql);

          // Record the migration in the ledger (parameterised).
          await client.query(
            'INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES ($1,$2,$3,$4)',
            [file.version, file.name, file.checksum, Date.now() - migrationStartTime],
          );

          // Commit.
          await client.query('COMMIT');

          const durationMs = Date.now() - migrationStartTime;
          newlyApplied.push({
            version: file.version,
            fileName: file.fileName,
            durationMs,
          });

          const fileWithoutExtension = file.fileName.replace(/\.sql$/, '');
          log(logger, `[apply] ${fileWithoutExtension} (${durationMs}ms)`);
        } catch (error) {
          // Rollback on error.
          try {
            await client.query('ROLLBACK');
          } catch {
            // Ignore rollback errors.
          }

          const message = error instanceof Error ? error.message : String(error);
          throw new MigrationError('sql-error', `Migration ${file.fileName} failed: ${message}`, {
            cause: error,
          });
        }
      }

      // Step 11: Build report.
      const report: MigrateReport = {
        schema,
        serverVersionNum,
        alreadyApplied: applied.map(a => a.version),
        newlyApplied,
        pendingAfter: [],
        missingFiles: plan.missingFiles,
        durationMs: Date.now() - startTime,
      };

      return report;
    } finally {
      // Release advisory lock.
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
    }
  } finally {
    // Always close the client.
    await client.end();
  }
}

export async function getMigrationStatus(options: MigrateOptions): Promise<MigrationStatus> {
  const schema = options.schema ?? DEFAULT_MIGRATION_SCHEMA;
  const migrationsDir = options.migrationsDir ?? MIGRATIONS_DIR;

  // Load files before connecting.
  const files = await loadMigrationFiles(migrationsDir);

  // Create client and connect.
  const client = createDbClient(options.connectionString);

  try {
    await client.connect();

    // Assert version.
    await assertSupportedServerVersion(client);

    // Apply search path.
    await applySearchPath(client, schema);

    // Check if ledger exists (without creating it as a side effect).
    const ledgerExistsResult = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('schema_migrations') IS NOT NULL AS exists",
    );

    const ledgerExists = ledgerExistsResult.rows[0]?.exists ?? false;

    let applied: AppliedMigration[] = [];

    if (ledgerExists) {
      // Load applied migrations from the ledger.
      const ledgerResult = await client.query<{
        version: string;
        name: string;
        checksum: string;
        applied_at: string;
      }>('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC');

      applied = ledgerResult.rows.map(row => ({
        version: row.version,
        name: row.name,
        checksum: row.checksum,
        appliedAt: row.applied_at,
      }));
    }

    // Compute plan.
    const plan = computeMigrationPlan(files, applied);

    return {
      schema,
      plan,
    };
  } finally {
    await client.end();
  }
}

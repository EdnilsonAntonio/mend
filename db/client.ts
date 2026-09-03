import pg from 'pg';
import type { Client as PgClient } from 'pg';
import { MigrationError } from './migration-files.js';

const { Client } = pg;

export const DEFAULT_MIGRATION_SCHEMA = 'public';
export const MIN_POSTGRES_VERSION_NUM = 130000;
export const MIGRATION_ADVISORY_LOCK_ID = 4104101;

export function resolveDatabaseUrl(env?: NodeJS.ProcessEnv): string | null {
  const url = (env ?? process.env).DATABASE_URL;
  if (typeof url === 'string' && url.trim() !== '') {
    return url.trim();
  }
  return null;
}

export function resolveTestDatabaseUrl(env?: NodeJS.ProcessEnv): string | null {
  const url = (env ?? process.env).MEND_TEST_DATABASE_URL;
  if (typeof url === 'string' && url.trim() !== '') {
    return url.trim();
  }
  return null;
}

export function isValidSchemaName(name: string): boolean {
  return /^[a-z_][a-z0-9_]{0,62}$/.test(name);
}

export function createDbClient(connectionString: string): PgClient {
  return new Client({ connectionString });
}

export async function assertSupportedServerVersion(client: PgClient): Promise<number> {
  const result = await client.query<{ v: string }>(
    "SELECT current_setting('server_version_num') AS v",
  );

  if (result.rows.length === 0 || result.rows[0] === undefined) {
    throw new MigrationError(
      'unsupported-server-version',
      'Could not query server_version_num',
    );
  }

  const versionNum = parseInt(result.rows[0].v, 10);
  if (Number.isNaN(versionNum) || versionNum < MIN_POSTGRES_VERSION_NUM) {
    throw new MigrationError(
      'unsupported-server-version',
      `PostgreSQL ${MIN_POSTGRES_VERSION_NUM} or higher required; server reports ${versionNum}`,
    );
  }

  return versionNum;
}

export async function applySearchPath(client: PgClient, schema: string): Promise<void> {
  if (!isValidSchemaName(schema)) {
    throw new MigrationError('invalid-schema-name', `Invalid schema name: ${schema}`);
  }

  // Create schema if it doesn't exist.
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

  // Set search_path to the schema.
  await client.query(`SET search_path TO "${schema}"`);
}

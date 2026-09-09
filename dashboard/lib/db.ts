import pg from 'pg';
import type { RowReader } from './attempts';

const { Pool } = pg;

export function resolveDashboardDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.DATABASE_URL;
  return typeof url === 'string' && url.trim() !== '' ? url.trim() : null;
}

const globalForPool = globalThis as unknown as { mendDashboardPool?: pg.Pool };

function getPool(connectionString: string): pg.Pool {
  const existing = globalForPool.mendDashboardPool;
  if (existing !== undefined) {
    return existing;
  }
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  // A pool-level error must not crash the Next.js server process.
  pool.on('error', () => {});
  globalForPool.mendDashboardPool = pool;
  return pool;
}

/** Null means DATABASE_URL is not set — the caller renders the "no database" panel. */
export function getRowReader(env: NodeJS.ProcessEnv = process.env): RowReader | null {
  const url = resolveDashboardDatabaseUrl(env);
  if (url === null) {
    return null;
  }
  const pool = getPool(url);
  return async (text, values) => {
    const result = await pool.query(text, values as unknown[]);
    return result.rows as readonly Record<string, unknown>[];
  };
}

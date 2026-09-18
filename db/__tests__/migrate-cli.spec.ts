import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly combined: string;
}

function runMigrateCli(databaseUrl: string, args: string[] = []): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, ['db/cli/migrate.cli.ts', ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('CLI timed out after 20000ms'));
    }, 20000);

    if (child.stdout) {
      child.stdout.on('data', (data: unknown) => {
        stdout += String(data);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data: unknown) => {
        stderr += String(data);
      });
    }

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      resolve({
        code,
        stdout,
        stderr,
        combined: stdout + stderr,
      });
    });

    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

const REFUSED_IP_URL = 'postgres://mend_user:sup3rs3cret@127.0.0.1:1/mend_nope';
const REFUSED_HOST_URL = 'postgres://mend_user:sup3rs3cret@localhost:1/mend_nope';

test('db:migrate against unreachable IP exits with code 1', async () => {
  const result = await runMigrateCli(REFUSED_IP_URL);
  expect(result.code).toBe(1);
});

test('db:migrate against unreachable IP prints the headline', async () => {
  const result = await runMigrateCli(REFUSED_IP_URL);
  expect(result.combined).toContain(
    'Could not reach DATABASE_URL — is Postgres running and is the database created?',
  );
});

test('db:migrate against unreachable IP prints target info and is not empty', async () => {
  const result = await runMigrateCli(REFUSED_IP_URL);
  expect(result.combined.trim().length).toBeGreaterThan(0);
  expect(result.combined).toContain('host=127.0.0.1');
  expect(result.combined).toContain('port=1');
  expect(result.combined).toContain('database=mend_nope');
});

test('db:migrate against unreachable IP never prints password', async () => {
  const result = await runMigrateCli(REFUSED_IP_URL);
  expect(result.combined).not.toContain('sup3rs3cret');
});

test('db:migrate against localhost:1 exits with code 1', async () => {
  const result = await runMigrateCli(REFUSED_HOST_URL);
  expect(result.code).toBe(1);
});

test('db:migrate against localhost:1 prints the headline', async () => {
  const result = await runMigrateCli(REFUSED_HOST_URL);
  expect(result.combined).toContain('Could not reach DATABASE_URL');
});

test('db:migrate --status against unreachable IP exits with code 1', async () => {
  const result = await runMigrateCli(REFUSED_IP_URL, ['--status']);
  expect(result.code).toBe(1);
});

test('db:migrate --status against unreachable IP prints the headline', async () => {
  const result = await runMigrateCli(REFUSED_IP_URL, ['--status']);
  expect(result.combined).toContain('Could not reach DATABASE_URL');
});

test('db:migrate with empty DATABASE_URL exits with code 1', async () => {
  const result = await runMigrateCli('');
  expect(result.code).toBe(1);
});

test('db:migrate with empty DATABASE_URL prints the message', async () => {
  const result = await runMigrateCli('');
  expect(result.combined).toContain('DATABASE_URL is not set');
});

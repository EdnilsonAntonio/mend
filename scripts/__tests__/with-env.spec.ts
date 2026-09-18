import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = join(REPO_ROOT, 'scripts', 'with-env.mjs');

interface WrapperResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runWrapper(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<WrapperResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let code: number | null = null;

    const timerHandle = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        code: null,
        stdout,
        stderr,
      });
    }, 15_000);

    const child = spawn(process.execPath, [WRAPPER, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data) => {
      stdout += data.toString('utf8');
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString('utf8');
    });

    child.on('close', (exitCode) => {
      clearTimeout(timerHandle);
      code = exitCode;
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}

let tempDir: string;

test.beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'mend-with-env-'));
  const fixtureContent = `# a comment line
MEND_FIXTURE_A=from-file

export MEND_FIXTURE_B=exported
MEND_FIXTURE_C="quoted value"
MEND_FIXTURE_D='single quoted'
MEND_FIXTURE_URL=postgres://u:p@localhost:5432/db?sslmode=require&x=1
MEND_FIXTURE_E=bare # trailing comment
this line has no equals sign
=novalue
`;
  await writeFile(join(tempDir, 'env-fixture'), fixtureContent);
});

test.afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test('Parses every supported form', async () => {
  const result = await runWrapper(
    [
      process.execPath,
      '-p',
      "JSON.stringify([process.env.MEND_FIXTURE_A ?? null, process.env.MEND_FIXTURE_B ?? null, process.env.MEND_FIXTURE_C ?? null, process.env.MEND_FIXTURE_D ?? null, process.env.MEND_FIXTURE_URL ?? null, process.env.MEND_FIXTURE_E ?? null])",
    ],
    { MEND_ENV_FILE: join(tempDir, 'env-fixture') },
  );

  const values = JSON.parse(result.stdout) as (string | null)[];
  expect(values).toEqual([
    'from-file',
    'exported',
    'quoted value',
    'single quoted',
    'postgres://u:p@localhost:5432/db?sslmode=require&x=1',
    'bare',
  ]);
  expect(result.code).toBe(0);
});

test('The shell wins', async () => {
  const result = await runWrapper(
    [
      process.execPath,
      '-p',
      "JSON.stringify([process.env.MEND_FIXTURE_A ?? null, process.env.MEND_FIXTURE_B ?? null, process.env.MEND_FIXTURE_C ?? null, process.env.MEND_FIXTURE_D ?? null, process.env.MEND_FIXTURE_URL ?? null, process.env.MEND_FIXTURE_E ?? null])",
    ],
    {
      MEND_ENV_FILE: join(tempDir, 'env-fixture'),
      MEND_FIXTURE_A: 'from-shell',
    },
  );

  const values = JSON.parse(result.stdout) as (string | null)[];
  expect(values[0]).toBe('from-shell');
  expect(result.code).toBe(0);
});

test('A missing env file is not an error', async () => {
  const result = await runWrapper(
    [process.execPath, '-p', "'ok'"],
    { MEND_ENV_FILE: join(tempDir, 'does-not-exist') },
  );

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('ok');
  expect(result.stderr).not.toContain('with-env:');
});

test('Exit code propagates', async () => {
  const result = await runWrapper(
    [process.execPath, '-e', 'process.exit(3)'],
    { MEND_ENV_FILE: join(tempDir, 'env-fixture') },
  );

  expect(result.code).toBe(3);
});

test('No command is a usage error', async () => {
  const result = await runWrapper([], {
    MEND_ENV_FILE: join(tempDir, 'env-fixture'),
  });

  expect(result.code).toBe(2);
  expect(result.stderr).toContain('usage');
});

test('Debug output is opt-in', async () => {
  const resultWithDebug = await runWrapper(
    [process.execPath, '-p', "'ok'"],
    {
      MEND_ENV_FILE: join(tempDir, 'env-fixture'),
      MEND_ENV_DEBUG: '1',
    },
  );

  expect(resultWithDebug.stderr).toContain('with-env: applied');

  const resultWithoutDebug = await runWrapper(
    [process.execPath, '-p', "'ok'"],
    { MEND_ENV_FILE: join(tempDir, 'env-fixture') },
  );

  expect(resultWithoutDebug.stderr).toBe('');
});

#!/usr/bin/env node
// Loads the repository's .env into process.env, then runs the command passed to it.
//
// Used by every root npm script that runs `tsx`, so that `npm run db:migrate`,
// `npm run heal`, etc. work in a freshly opened terminal without a manual
// `source .env` step. See README.md § Setup.
//
// Rules, deliberately boring:
//   * A variable already present in the environment is never overwritten.
//     Your shell (or direnv) always wins over the file.
//   * A missing .env is not an error — the command still runs, and whatever
//     reads the variable reports its own loud error (see db/cli/migrate.cli.ts).
//   * The child's exit code is this process's exit code.
//
// Env file path: $MEND_ENV_FILE if set (resolved against the repo root),
// otherwise <repo root>/.env. Set MEND_ENV_DEBUG=1 to see what was loaded.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Minimal dotenv parser: `KEY=value`, optional `export ` prefix, `#` comments,
 * single or double quotes. Splits on the FIRST `=` so connection strings
 * containing `?sslmode=require` survive intact.
 *
 * @param {string} contents
 * @returns {Record<string, string>}
 */
function parseEnvFile(contents) {
  /** @type {Record<string, string>} */
  const parsed = {};
  for (const rawLine of contents.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = body.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = body.slice(0, eq).trim();
    if (!KEY_PATTERN.test(key)) {
      continue;
    }
    let value = body.slice(eq + 1).trim();
    const quote = value.length >= 2 ? value[0] : '';
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    } else {
      const commentAt = value.search(/\s#/);
      if (commentAt !== -1) {
        value = value.slice(0, commentAt).trimEnd();
      }
    }
    parsed[key] = value;
  }
  return parsed;
}

/**
 * Applies parsed values to `env`, never overwriting an existing variable.
 *
 * @param {Record<string, string>} parsed
 * @param {NodeJS.ProcessEnv} env
 * @returns {number} how many variables were applied
 */
function applyEnv(parsed, env) {
  let applied = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
      applied += 1;
    }
  }
  return applied;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stderr.write('with-env: usage: node scripts/with-env.mjs <command> [args...]\n');
    process.exitCode = 2;
    return;
  }

  const envFilePath = resolve(REPO_ROOT, process.env.MEND_ENV_FILE ?? '.env');
  let loaded = false;
  let applied = 0;
  try {
    const contents = readFileSync(envFilePath, 'utf8');
    loaded = true;
    applied = applyEnv(parseEnvFile(contents), process.env);
  } catch (error) {
    // A missing .env is normal. Anything else is worth saying out loud.
    if (error?.code !== 'ENOENT') {
      const reason = error?.message ?? String(error);
      process.stderr.write(`with-env: could not read ${envFilePath}: ${reason}\n`);
    }
  }
  if (process.env.MEND_ENV_DEBUG === '1') {
    process.stderr.write(
      loaded
        ? `with-env: applied ${applied} variable(s) from ${envFilePath}\n`
        : `with-env: no env file at ${envFilePath}\n`,
    );
  }

  const [command, ...args] = argv;
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    // npm's .bin shims are .cmd files on Windows and cannot be spawned directly.
    shell: process.platform === 'win32',
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on('error', (error) => {
    process.stderr.write(`with-env: failed to run "${command}": ${error.message}\n`);
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    process.exitCode = signal !== null ? 1 : (code ?? 0);
  });
}

main();

import { test, expect } from '@playwright/test';
import {
  loadMigrationFiles,
  computeChecksum,
  parseMigrationFileName,
  computeMigrationPlan,
} from '../migration-files.js';
import { isValidSchemaName } from '../client.js';
import {
  HEAL_ATTEMPTS_COLUMNS,
  HEAL_ATTEMPTS_CONSTRAINTS,
  HEAL_CONFIDENCE_VALUES,
  HEAL_STATUS_VALUES,
  TOOL_CALL_COUNT_CEILING,
} from '../schema-contract.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/bad-dir',
);

test('loadMigrationFiles returns exactly two files in order', async () => {
  const files = await loadMigrationFiles();
  expect(files).toHaveLength(2);
  expect(files[0]?.version).toBe('0001');
  expect(files[0]?.name).toBe('test_runs');
  expect(files[1]?.version).toBe('0002');
  expect(files[1]?.name).toBe('heal_attempts');
});

test('migration file sql is non-empty and checksum is 64 lowercase hex', async () => {
  const files = await loadMigrationFiles();
  for (const file of files) {
    expect(file.sql).not.toBe('');
    expect(file.checksum).toMatch(/^[a-f0-9]{64}$/);
  }
});

test('computeChecksum is sensitive to content', () => {
  const a = computeChecksum('a');
  const aNewline = computeChecksum('a\n');
  expect(a).not.toBe(aNewline);
});

test('parseMigrationFileName accepts valid names', () => {
  const result = parseMigrationFileName('0001_test_runs.sql');
  expect(result).toEqual({ version: '0001', name: 'test_runs' });
});

test('parseMigrationFileName rejects invalid names', () => {
  expect(parseMigrationFileName('1_x.sql')).toBeNull();
  expect(parseMigrationFileName('0001-x.sql')).toBeNull();
  expect(parseMigrationFileName('0001_X.sql')).toBeNull();
  expect(parseMigrationFileName('0001_x.txt')).toBeNull();
  expect(parseMigrationFileName('README.md')).toBeNull();
});

test('loadMigrationFiles from bad-dir throws on bad filename', async () => {
  await expect(loadMigrationFiles(fixtureDir)).rejects.toThrow('Invalid migration filename');
});

test('computeMigrationPlan with empty applied list', async () => {
  const files = await loadMigrationFiles();
  const plan = computeMigrationPlan(files, []);
  expect(plan.pending).toHaveLength(2);
  expect(plan.checksumMismatches).toHaveLength(0);
});

test('computeMigrationPlan excludes already applied migrations', async () => {
  const files = await loadMigrationFiles();
  const applied = [
    {
      version: '0001',
      name: 'test_runs',
      checksum: files[0]!.checksum,
      appliedAt: new Date().toISOString(),
    },
  ];
  const plan = computeMigrationPlan(files, applied);
  expect(plan.pending).toHaveLength(1);
  expect(plan.pending[0]?.version).toBe('0002');
  expect(plan.checksumMismatches).toHaveLength(0);
});

test('computeMigrationPlan detects checksum mismatches', async () => {
  const files = await loadMigrationFiles();
  const applied = [
    {
      version: '0001',
      name: 'test_runs',
      checksum: 'deadbeef00000000000000000000000000000000000000000000000000000000',
      appliedAt: new Date().toISOString(),
    },
  ];
  const plan = computeMigrationPlan(files, applied);
  expect(plan.checksumMismatches).toHaveLength(1);
  // 0001 is not pending because it's already applied (just with wrong checksum).
  // 0002 is pending because it hasn't been applied yet.
  expect(plan.pending).toHaveLength(1);
  expect(plan.pending[0]?.version).toBe('0002');
});

test('computeMigrationPlan detects missing files', async () => {
  const files = await loadMigrationFiles();
  const applied = [
    {
      version: '0009',
      name: 'example',
      checksum: 'deadbeef00000000000000000000000000000000000000000000000000000000',
      appliedAt: new Date().toISOString(),
    },
  ];
  const plan = computeMigrationPlan(files, applied);
  expect(plan.missingFiles).toEqual(['0009']);
});

test('isValidSchemaName accepts valid names', () => {
  expect(isValidSchemaName('public')).toBe(true);
  expect(isValidSchemaName('mend_test_1')).toBe(true);
});

test('isValidSchemaName rejects invalid names', () => {
  expect(isValidSchemaName('')).toBe(false);
  expect(isValidSchemaName('Public')).toBe(false);
  expect(isValidSchemaName('1abc')).toBe(false);
  expect(isValidSchemaName('pg cat')).toBe(false);
  expect(isValidSchemaName('"; DROP TABLE test_runs; --')).toBe(false);
  // 64 character name (exceeds 63 limit after first char)
  const tooLongName = 'a' + 'b'.repeat(63);
  expect(isValidSchemaName(tooLongName)).toBe(false);
});

test('0001_test_runs.sql contains required columns', async () => {
  const files = await loadMigrationFiles();
  const file = files[0]!;

  const columns = ['id', 'started_at', 'finished_at', 'total', 'passed', 'failed'];
  for (const col of columns) {
    const pattern = new RegExp('^\\s+' + col + '\\s+\\w', 'm');
    expect(file.sql).toMatch(pattern);
  }

  expect(file.sql).toContain('CONSTRAINT test_runs_pkey PRIMARY KEY (id)');
});

test('0002_heal_attempts.sql contains enum definitions', async () => {
  const files = await loadMigrationFiles();
  const file = files[1]!;

  expect(file.sql).toContain("CREATE TYPE heal_confidence AS ENUM ('high', 'low', 'none')");
  expect(file.sql).toContain(
    "CREATE TYPE heal_status AS ENUM ('investigating', 'healed', 'needs_review', 'failed')",
  );
});

test('0002_heal_attempts.sql contains all heal_attempts columns', async () => {
  const files = await loadMigrationFiles();
  const file = files[1]!;

  for (const col of HEAL_ATTEMPTS_COLUMNS) {
    const pattern = new RegExp('^\\s+' + col.name + '\\s+\\w', 'm');
    expect(file.sql).toMatch(pattern);
  }
});

test('0002_heal_attempts.sql contains all constraint names', async () => {
  const files = await loadMigrationFiles();
  const file = files[1]!;

  for (const constraint of HEAL_ATTEMPTS_CONSTRAINTS) {
    expect(file.sql).toContain(`CONSTRAINT ${constraint}`);
  }
});

test('migration files do not contain DROP TABLE, DROP TYPE, or TRUNCATE', async () => {
  const files = await loadMigrationFiles();
  for (const file of files) {
    expect(file.sql).not.toContain('DROP TABLE');
    expect(file.sql).not.toContain('DROP TYPE');
    expect(file.sql).not.toContain('TRUNCATE');
  }
});

test('enum values match schema contract', () => {
  expect(HEAL_CONFIDENCE_VALUES).toEqual(['high', 'low', 'none']);
  expect(HEAL_STATUS_VALUES).toEqual(['investigating', 'healed', 'needs_review', 'failed']);
});

test('tool call count ceiling is 5', () => {
  expect(TOOL_CALL_COUNT_CEILING).toBe(5);
});

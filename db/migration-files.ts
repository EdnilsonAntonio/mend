import { createHash } from 'crypto';
import { readdir, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export type MigrationErrorCode =
  | 'bad-file-name'
  | 'duplicate-version'
  | 'checksum-mismatch'
  | 'invalid-schema-name'
  | 'missing-connection-string'
  | 'unsupported-server-version'
  | 'sql-error';

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(code: MigrationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = 'MigrationError';
  }
}

export interface MigrationFile {
  /** Zero-padded, e.g. '0001'. Sorts correctly as a string. */
  readonly version: string;
  /** Snake-case remainder of the filename, e.g. 'test_runs'. */
  readonly name: string;
  /** e.g. '0001_test_runs.sql'. */
  readonly fileName: string;
  /** Exact file contents, utf8, unmodified. */
  readonly sql: string;
  /** sha256 hex of `sql`, 64 lowercase hex chars. */
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  /** ISO 8601 string. */
  readonly appliedAt: string;
}

export interface ChecksumMismatch {
  readonly version: string;
  readonly fileName: string;
  /** The checksum recorded in schema_migrations. */
  readonly recordedChecksum: string;
  /** The checksum of the file on disk now. */
  readonly actualChecksum: string;
}

export interface MigrationPlan {
  readonly all: readonly MigrationFile[];
  readonly applied: readonly AppliedMigration[];
  readonly pending: readonly MigrationFile[];
  readonly checksumMismatches: readonly ChecksumMismatch[];
  /** Versions in the ledger with no file on disk. */
  readonly missingFiles: readonly string[];
}

export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

// Resolve MIGRATIONS_DIR from this module's location, not from cwd.
// This allows the CLI to be invoked from subdirectories without breaking.
export const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

export function computeChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function parseMigrationFileName(
  fileName: string,
): { readonly version: string; readonly name: string } | null {
  const match = fileName.match(MIGRATION_FILE_PATTERN);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }

  return {
    version: match[1],
    name: match[2],
  };
}

export async function loadMigrationFiles(dir = MIGRATIONS_DIR): Promise<readonly MigrationFile[]> {
  const entries = await readdir(dir);

  // Validate all filenames first, then load SQL.
  const parsed: Array<{
    fileName: string;
    version: string;
    name: string;
  }> = [];

  for (const fileName of entries) {
    const result = parseMigrationFileName(fileName);
    if (!result) {
      throw new MigrationError('bad-file-name', `Invalid migration filename: ${fileName}`);
    }
    parsed.push({ fileName, version: result.version, name: result.name });
  }

  // Check for duplicate versions.
  const versions = new Set<string>();
  for (const item of parsed) {
    if (versions.has(item.version)) {
      throw new MigrationError('duplicate-version', `Duplicate migration version: ${item.version}`);
    }
    versions.add(item.version);
  }

  // Sort by version ascending (string sort because versions are zero-padded).
  parsed.sort((a, b) => a.version.localeCompare(b.version));

  // Load SQL files.
  const files: MigrationFile[] = [];
  for (const item of parsed) {
    const filePath = join(dir, item.fileName);
    const sql = await readFile(filePath, 'utf8');
    files.push({
      version: item.version,
      name: item.name,
      fileName: item.fileName,
      sql,
      checksum: computeChecksum(sql),
    });
  }

  return files;
}

export function computeMigrationPlan(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  const appliedMap = new Map<string, AppliedMigration>();
  for (const row of applied) {
    appliedMap.set(row.version, row);
  }

  const pending: MigrationFile[] = [];
  const checksumMismatches: ChecksumMismatch[] = [];

  // Check each file: is it pending or is its checksum wrong?
  for (const file of files) {
    const appliedRow = appliedMap.get(file.version);
    if (!appliedRow) {
      // Not yet applied.
      pending.push(file);
    } else if (appliedRow.checksum !== file.checksum) {
      // Already applied, but checksum differs.
      checksumMismatches.push({
        version: file.version,
        fileName: file.fileName,
        recordedChecksum: appliedRow.checksum,
        actualChecksum: file.checksum,
      });
    }
  }

  // Find applied versions with no file on disk.
  const missingFiles: string[] = [];
  for (const version of appliedMap.keys()) {
    if (!files.some(f => f.version === version)) {
      missingFiles.push(version);
    }
  }
  missingFiles.sort();

  return {
    all: files,
    applied,
    pending,
    checksumMismatches,
    missingFiles,
  };
}

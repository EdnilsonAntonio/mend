import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { applySelectorSubstitution } from './spec-edit.js';
import { checkAssertionIntegrity, diffChangedLines } from './assertion-integrity.js';

export type VerificationRejection =
  | 'spec-file-unreadable'
  | 'unsafe-candidate-selector'
  | 'candidate-identical-to-original'
  | 'selector-not-found'
  | 'selector-ambiguous'
  | 'assertion-integrity'
  | 'original-spec-mutated'
  | 'results-unavailable';

// Re-export from spec-edit for public API
export type {
  SubstitutionResult,
  SubstitutionFailure,
} from './spec-edit.js';
export {
  applySelectorSubstitution,
  extractStringLiterals,
  MAX_CANDIDATE_SELECTOR_LENGTH,
  FORBIDDEN_SELECTOR_SUBSTRINGS,
} from './spec-edit.js';

// Re-export from assertion-integrity for public API
export type {
  AssertionIntegrityResult,
  IntegrityRuleId,
  AllowedLiteralChange,
} from './assertion-integrity.js';
export {
  checkAssertionIntegrity,
  diffChangedLines,
  ASSERTION_MATCHERS,
} from './assertion-integrity.js';

export interface RunSingleTestInput {
  /** Path to the original spec, absolute or relative to the repository root. */
  readonly specFile: string;
  /** Exact `test()` title. */
  readonly testName: string;
  /** The selector currently in the spec, without quotes. */
  readonly originalSelector: string;
  /** The proposed replacement, without quotes. */
  readonly candidateSelector: string;
  /** Overrides RUN_SINGLE_TEST_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

export interface VerifySpecSourceInput {
  readonly specFile: string;
  readonly testName: string;
  /** The complete proposed spec source. Always goes through the integrity gate. */
  readonly proposedSource: string;
  /** null means the proposed source must be literal-identical to the original. */
  readonly allowedLiteralChange: {
    readonly fromLiteral: string;
    readonly toLiteral: string;
  } | null;
  readonly timeoutMs?: number;
}

export interface IntegrityViolation {
  readonly rule: string;
  readonly detail: string;
}

export interface SpecLineChange {
  readonly lineNumber: number;
  readonly before: string;
  readonly after: string;
}

export interface RunSingleTestResult {
  /** True only if the test actually executed and the JSON report shows exactly one expected pass. */
  readonly passed: boolean;
  /** Combined child stdout+stderr, clamped. Empty when nothing was executed. */
  readonly output: string;
  /** False means no child process was ever spawned. */
  readonly executed: boolean;
  /** Child exit code, or null when nothing was executed or the spawn failed. */
  readonly exitCode: number | null;
  /** True when the child was killed at the timeout. */
  readonly timedOut: boolean;
  /** null when the call reached execution without being rejected. */
  readonly rejected: VerificationRejection | null;
  /** Non-empty only when `rejected` is 'assertion-integrity'. */
  readonly violations: readonly IntegrityViolation[];
  /** Repository-relative or caller-supplied spec path, verbatim. */
  readonly specFile: string;
  readonly testName: string;
  /** Empty string on the verifySpecSource path. */
  readonly originalSelector: string;
  /** Empty string on the verifySpecSource path. */
  readonly candidateSelector: string;
  /** The source that was (or would have been) executed. null when substitution failed. */
  readonly proposedSource: string | null;
  /** Empty when line counts differ or nothing changed. */
  readonly changedLines: readonly SpecLineChange[];
  /** Wall-clock duration of the whole call. */
  readonly durationMs: number;
}

export const TEMP_ROOT_DIR_NAME = 'mend-tmp';
export const RUN_SINGLE_TEST_TIMEOUT_MS = 90_000;
export const RUN_SINGLE_TEST_MAX_OUTPUT_CHARS = 8_000;
export const VERIFY_CONFIG_PATH = 'playwright.verify.config.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAYWRIGHT_CLI = join(
  dirname(createRequire(import.meta.url).resolve('playwright')),
  'cli.js',
);

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampOutput(text: string): string {
  if (text.length <= RUN_SINGLE_TEST_MAX_OUTPUT_CHARS) {
    return text;
  }
  return text.slice(0, 4000) + '\n…[output truncated]…\n' + text.slice(-4000);
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Delete PW_*, PWTEST_*, and PLAYWRIGHT_* keys except PLAYWRIGHT_BROWSERS_PATH
  const keysToDelete: string[] = [];
  for (const key of Object.keys(env)) {
    if (
      (key.startsWith('PW_') || key.startsWith('PWTEST_') || key.startsWith('PLAYWRIGHT_')) &&
      key !== 'PLAYWRIGHT_BROWSERS_PATH'
    ) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    delete env[key];
  }

  // Delete additional test-related env vars
  delete env['TEST_WORKER_INDEX'];
  delete env['TEST_PARALLEL_INDEX'];
  delete env['FORCE_COLOR'];

  return env;
}

function rejectedResult(
  rejected: VerificationRejection,
  output: string,
): RunSingleTestResult {
  return {
    passed: false,
    output,
    executed: false,
    exitCode: null,
    timedOut: false,
    rejected,
    violations: [],
    specFile: '',
    testName: '',
    originalSelector: '',
    candidateSelector: '',
    proposedSource: null,
    changedLines: [],
    durationMs: 0,
  };
}

export async function verifySpecSource(
  input: VerifySpecSourceInput,
): Promise<RunSingleTestResult> {
  const startedAt = Date.now();
  const specPath = resolve(REPO_ROOT, input.specFile);

  // Read original and compute hash
  let originalSource: string;
  let originalHash: string;
  try {
    originalSource = await readFile(specPath, 'utf8');
    originalHash = sha256(originalSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...rejectedResult('spec-file-unreadable', message),
      specFile: input.specFile,
      testName: input.testName,
      durationMs: Date.now() - startedAt,
    };
  }

  // Integrity gate - before anything is written or spawned
  const integrity = checkAssertionIntegrity(
    originalSource,
    input.proposedSource,
    input.allowedLiteralChange,
  );

  if (!integrity.ok) {
    return {
      passed: false,
      executed: false,
      output: '',
      exitCode: null,
      timedOut: false,
      rejected: 'assertion-integrity',
      violations: integrity.violations,
      specFile: input.specFile,
      testName: input.testName,
      originalSelector: '',
      candidateSelector: '',
      proposedSource: input.proposedSource,
      changedLines: [],
      durationMs: Date.now() - startedAt,
    };
  }

  // Create temp directory
  const tempRootDir = join(REPO_ROOT, TEMP_ROOT_DIR_NAME);
  await mkdir(tempRootDir, { recursive: true });
  const tempDir = await mkdtemp(tempRootDir + '/run-');
  const tempSpecPath = join(tempDir, basename(specPath));

  try {
    // Write temp copy
    await writeFile(tempSpecPath, input.proposedSource);

    // Spawn child process
    const childProcess = spawn(
      process.execPath,
      [
        PLAYWRIGHT_CLI,
        'test',
        `--config=${VERIFY_CONFIG_PATH}`,
        `--grep=${escapeRegExp(input.testName)}`,
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...childEnv(),
          MEND_VERIFY_DIR: tempDir,
          MEND_VERIFY_JSON: join(tempDir, 'results.json'),
        },
      },
    );

    let output = '';
    let timedOut = false;
    let exitCode: number | null = null;
    let timeoutHandle: NodeJS.Timeout | undefined;

    // Collect output
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        output += data.toString();
      });
    }

    // Set timeout
    const timeoutMs = input.timeoutMs ?? RUN_SINGLE_TEST_TIMEOUT_MS;
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      childProcess.kill('SIGKILL');
    }, timeoutMs);

    // Wait for close
    await new Promise<void>((resolve) => {
      childProcess.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        exitCode = code ?? 1;
        resolve();
      });

      childProcess.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        output += error.message;
        resolve();
      });
    });

    // Read and parse results
    let passed = false;
    let rejected: VerificationRejection | null = null;

    try {
      const reportText = await readFile(join(tempDir, 'results.json'), 'utf8');
      const report = JSON.parse(reportText) as {
        stats?: {
          expected?: number;
          unexpected?: number;
          flaky?: number;
          skipped?: number;
        };
      };

      const stats = report.stats ?? {};
      const statsExpected = stats.expected ?? NaN;
      const statsUnexpected = stats.unexpected ?? NaN;
      const statsFlaky = stats.flaky ?? NaN;
      const statsSkipped = stats.skipped ?? NaN;

      passed =
        exitCode === 0 &&
        !timedOut &&
        statsExpected === 1 &&
        statsUnexpected === 0 &&
        statsFlaky === 0 &&
        statsSkipped === 0;
    } catch {
      rejected = 'results-unavailable';
      passed = false;
    }

    // Post-run hash check
    let postHash: string;
    try {
      const postSource = await readFile(specPath, 'utf8');
      postHash = sha256(postSource);
    } catch {
      postHash = 'error';
    }

    if (postHash !== originalHash) {
      passed = false;
      rejected = 'original-spec-mutated';
    }

    return {
      passed,
      executed: true,
      output: clampOutput(output),
      exitCode,
      timedOut,
      rejected,
      violations: [],
      specFile: input.specFile,
      testName: input.testName,
      originalSelector: '',
      candidateSelector: '',
      proposedSource: input.proposedSource,
      changedLines: diffChangedLines(originalSource, input.proposedSource),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function runSingleTest(input: RunSingleTestInput): Promise<RunSingleTestResult> {
  const startedAt = Date.now();
  const specPath = resolve(REPO_ROOT, input.specFile);

  // Read original spec
  let originalSource: string;
  try {
    originalSource = await readFile(specPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      executed: false,
      output: message,
      exitCode: null,
      timedOut: false,
      rejected: 'spec-file-unreadable',
      violations: [],
      specFile: input.specFile,
      testName: input.testName,
      originalSelector: input.originalSelector,
      candidateSelector: input.candidateSelector,
      proposedSource: null,
      changedLines: [],
      durationMs: Date.now() - startedAt,
    };
  }

  // Apply substitution
  const sub = applySelectorSubstitution(
    originalSource,
    input.originalSelector,
    input.candidateSelector,
  );

  if (!sub.ok) {
    return {
      passed: false,
      executed: false,
      output: sub.detail,
      exitCode: null,
      timedOut: false,
      rejected: sub.failure as VerificationRejection,
      violations: [],
      specFile: input.specFile,
      testName: input.testName,
      originalSelector: input.originalSelector,
      candidateSelector: input.candidateSelector,
      proposedSource: null,
      changedLines: [],
      durationMs: Date.now() - startedAt,
    };
  }

  // Delegate to verifySpecSource
  const verifyResult = await verifySpecSource({
    specFile: input.specFile,
    testName: input.testName,
    proposedSource: sub.proposedSource as string,
    allowedLiteralChange: { fromLiteral: sub.fromLiteral!, toLiteral: sub.toLiteral! },
    timeoutMs: input.timeoutMs,
  });

  // Add originalSelector and candidateSelector to result
  const result: RunSingleTestResult = {
    passed: verifyResult.passed,
    output: verifyResult.output,
    executed: verifyResult.executed,
    exitCode: verifyResult.exitCode,
    timedOut: verifyResult.timedOut,
    rejected: verifyResult.rejected,
    violations: verifyResult.violations,
    specFile: verifyResult.specFile,
    testName: verifyResult.testName,
    originalSelector: input.originalSelector,
    candidateSelector: input.candidateSelector,
    proposedSource: verifyResult.proposedSource,
    changedLines: verifyResult.changedLines,
    durationMs: verifyResult.durationMs,
  };
  return result;
}

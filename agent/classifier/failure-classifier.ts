import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// TYPES
// ============================================================================

export type FailureClassification = 'selector-drift' | 'other';

export type SelectorDriftRuleId =
  | 'strict-mode-violation'
  | 'element-not-found'
  | 'timeout-waiting-for-locator';

export type OtherReasonId =
  | 'no-error-output'
  | 'navigation-failure'
  | 'page-exception'
  | 'element-resolved'
  | 'test-timeout'
  | 'selector-not-extractable'
  | 'unrecognized';

export type ClassificationRuleId = SelectorDriftRuleId | OtherReasonId;

export interface ErrorSignals {
  readonly hasLocator: boolean;
  readonly strictModeViolation: boolean;
  readonly elementNotFound: boolean;
  readonly waitingForLocator: boolean;
  readonly locatorResolved: boolean;
  readonly timeoutExceeded: boolean;
  readonly testTimeout: boolean;
  readonly navigationFailure: boolean;
  readonly pageException: boolean;
}

export interface ErrorClassification {
  readonly classification: FailureClassification;
  readonly rule: ClassificationRuleId;
  /** The selector literal lifted out of the Playwright error, verbatim, unquoted. */
  readonly selector: string | null;
  readonly signals: ErrorSignals;
}

export interface ClassifiedFailure {
  /** Repository-relative, forward slashes, e.g. 'tests/login-submit.spec.ts'. */
  readonly specFile: string;
  /** Exact `test()` title, suitable for run_single_test's `testName`. */
  readonly testName: string;
  /** Playwright project name, e.g. 'chromium'. Empty string if absent. */
  readonly projectName: string;
  readonly classification: FailureClassification;
  readonly rule: ClassificationRuleId;
  /** null only when classification is 'other'. */
  readonly selector: string | null;
  /** ANSI-stripped, clamped to MAX_ERROR_TEXT_CHARS. */
  readonly errorText: string;
  readonly signals: ErrorSignals;
}

export interface ClassificationReport {
  /** Every (spec, test) pair seen in the report, passing or not. */
  readonly totalTests: number;
  /** Tests whose status is 'unexpected'. Equals healQueue.length + skipped.length. */
  readonly failedTests: number;
  /** Failures worth sending to the agent. Every entry has classification 'selector-drift'. */
  readonly healQueue: readonly ClassifiedFailure[];
  /** Failures recorded and skipped. Every entry has classification 'other'. */
  readonly skipped: readonly ClassifiedFailure[];
}

// ============================================================================
// MODULE CONSTANTS
// ============================================================================

export const DEFAULT_RESULTS_PATH = 'test-results/results.json';
export const MAX_ERROR_TEXT_CHARS = 8_000;

export const CLASSIFICATION_RULE_ORDER: readonly ClassificationRuleId[] = [
  'strict-mode-violation',
  'no-error-output',
  'navigation-failure',
  'page-exception',
  'element-resolved',
  'element-not-found',
  'timeout-waiting-for-locator',
  'test-timeout',
  'unrecognized',
];

// ============================================================================
// REGEX CONSTANTS (private)
// ============================================================================

const ANSI_SGR = /\[[0-9;]*m/g;
const STRICT_MODE = /strict mode violation/i;
const ELEMENT_NOT_FOUND = /element\(s\) not found|resolved to 0 elements/i;
const WAITING_FOR_LOCATOR = /waiting for locator\(/i;
const LOCATOR_RESOLVED = /locator resolved to/i;
const TIMEOUT_EXCEEDED = /Timeout \d+ms exceeded|Timeout:\s*\d+ms/i;
const TEST_TIMEOUT = /Test timeout of \d+ms exceeded/i;
const NAVIGATION_FAILURE = /page\.goto:|net::ERR_|NS_ERROR_/i;
const PAGE_EXCEPTION =
  /^(?:Error:\s*)?(?:ReferenceError|TypeError|SyntaxError|RangeError|EvalError|URIError):/;
const LOCATOR_SINGLE_QUOTED = /locator\(\s*'((?:[^'\\]|\\.)*)'\s*\)/;
const LOCATOR_DOUBLE_QUOTED = /locator\(\s*"((?:[^"\\]|\\.)*)"\s*\)/;
const LOCATOR_LINE = /^Locator:\s*(.+)$/;
const WAITING_FOR_SINGLE = /waiting for locator\(\s*'((?:[^'\\]|\\.)*)'\s*\)/;
const WAITING_FOR_DOUBLE = /waiting for locator\(\s*"((?:[^"\\]|\\.)*)"\s*\)/;

// ============================================================================
// STRIP ANSI & EXTRACT SELECTOR
// ============================================================================

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR, '');
}

export function extractSelector(errorText: string): string | null {
  const text = stripAnsi(errorText);

  // Step 1: Locator: line
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const locatorMatch = trimmed.match(LOCATOR_LINE);
    if (locatorMatch && locatorMatch[1]) {
      const locatorContent = locatorMatch[1];
      const singleMatch = locatorContent.match(LOCATOR_SINGLE_QUOTED);
      if (singleMatch && singleMatch[1]) {
        const selector = singleMatch[1].trim();
        if (selector !== '') {
          return selector;
        }
      }
      const doubleMatch = locatorContent.match(LOCATOR_DOUBLE_QUOTED);
      if (doubleMatch && doubleMatch[1]) {
        const selector = doubleMatch[1].trim();
        if (selector !== '') {
          return selector;
        }
      }
    }
  }

  // Step 2: Call log
  const waitingSingleMatch = text.match(WAITING_FOR_SINGLE);
  if (waitingSingleMatch && waitingSingleMatch[1]) {
    const selector = waitingSingleMatch[1].trim();
    if (selector !== '') {
      return selector;
    }
  }

  const waitingDoubleMatch = text.match(WAITING_FOR_DOUBLE);
  if (waitingDoubleMatch && waitingDoubleMatch[1]) {
    const selector = waitingDoubleMatch[1].trim();
    if (selector !== '') {
      return selector;
    }
  }

  // Step 3: Anywhere
  const locatorSingleMatch = text.match(LOCATOR_SINGLE_QUOTED);
  if (locatorSingleMatch && locatorSingleMatch[1]) {
    const selector = locatorSingleMatch[1].trim();
    if (selector !== '') {
      return selector;
    }
  }

  const locatorDoubleMatch = text.match(LOCATOR_DOUBLE_QUOTED);
  if (locatorDoubleMatch && locatorDoubleMatch[1]) {
    const selector = locatorDoubleMatch[1].trim();
    if (selector !== '') {
      return selector;
    }
  }

  // Step 4: Return null
  return null;
}

// ============================================================================
// ERROR SIGNALS
// ============================================================================

export function collectErrorSignals(errorText: string): ErrorSignals {
  const text = stripAnsi(errorText);
  const selector = extractSelector(text);
  const firstNonEmptyLine = text.split('\n').find((l) => l.trim() !== '') ?? '';

  return {
    hasLocator: selector !== null,
    strictModeViolation: STRICT_MODE.test(text),
    elementNotFound: ELEMENT_NOT_FOUND.test(text),
    waitingForLocator: WAITING_FOR_LOCATOR.test(text),
    locatorResolved: LOCATOR_RESOLVED.test(text),
    timeoutExceeded: TIMEOUT_EXCEEDED.test(text),
    testTimeout: TEST_TIMEOUT.test(text),
    navigationFailure: NAVIGATION_FAILURE.test(text),
    pageException: PAGE_EXCEPTION.test(firstNonEmptyLine.trim()),
  };
}

// ============================================================================
// CLASSIFY ERROR TEXT
// ============================================================================

export function classifyErrorText(errorText: string): ErrorClassification {
  const text = stripAnsi(errorText);
  const selector = extractSelector(text);
  const signals = collectErrorSignals(text);

  // Determine classification and rule by ordered if-chain
  let classification: FailureClassification = 'other';
  let rule: ClassificationRuleId = 'unrecognized';

  if (signals.strictModeViolation) {
    classification = 'selector-drift';
    rule = 'strict-mode-violation';
  } else if (text.trim() === '') {
    classification = 'other';
    rule = 'no-error-output';
  } else if (signals.navigationFailure) {
    classification = 'other';
    rule = 'navigation-failure';
  } else if (signals.pageException) {
    classification = 'other';
    rule = 'page-exception';
  } else if (signals.locatorResolved) {
    classification = 'other';
    rule = 'element-resolved';
  } else if (signals.elementNotFound) {
    classification = 'selector-drift';
    rule = 'element-not-found';
  } else if (signals.waitingForLocator && signals.timeoutExceeded) {
    classification = 'selector-drift';
    rule = 'timeout-waiting-for-locator';
  } else if (signals.testTimeout) {
    classification = 'other';
    rule = 'test-timeout';
  } else {
    classification = 'other';
    rule = 'unrecognized';
  }

  // Post-check: if selector-drift but no selector, downgrade to other
  if (classification === 'selector-drift' && selector === null) {
    classification = 'other';
    rule = 'selector-not-extractable';
  }

  return { classification, rule, selector, signals };
}

// ============================================================================
// CLASSIFY FAILURES
// ============================================================================

interface RawJsonReportError {
  readonly message?: string;
  readonly stack?: string;
}

interface RawTestResult {
  readonly status?: string;
  readonly error?: RawJsonReportError;
  readonly errors?: readonly RawJsonReportError[];
}

interface RawTest {
  readonly projectName?: string;
  readonly status?: string;
  readonly results?: readonly RawTestResult[];
}

interface RawSpec {
  readonly title?: string;
  readonly file?: string;
  readonly tests?: readonly RawTest[];
}

interface RawSuite {
  readonly specs?: readonly RawSpec[];
  readonly suites?: readonly RawSuite[];
}

interface RawJsonReport {
  readonly config?: { readonly rootDir?: string };
  readonly suites?: readonly RawSuite[];
}

function collectErrorText(result: RawTestResult): string {
  const candidates: string[] = [];

  // Collect errors[i].message
  if (result.errors) {
    for (const error of result.errors) {
      if (error.message && error.message.trim() !== '') {
        candidates.push(error.message);
      }
    }
  }

  // Collect error.message
  if (result.error?.message && result.error.message.trim() !== '') {
    candidates.push(result.error.message);
  }

  // Collect error.stack
  if (result.error?.stack && result.error.stack.trim() !== '') {
    candidates.push(result.error.stack);
  }

  // Remove exact duplicates preserving first occurrence
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      unique.push(candidate);
    }
  }

  const joined = unique.join('\n');
  return stripAnsi(joined);
}

function clampErrorText(text: string): string {
  if (text.length <= MAX_ERROR_TEXT_CHARS) {
    return text;
  }
  return text.slice(0, 4000) + '\n…[error text truncated]…\n' + text.slice(-4000);
}

export function classifyFailures(report: unknown): ClassificationReport {
  const raw = (report ?? {}) as RawJsonReport;

  const rootDir = raw.config?.rootDir ?? '';
  const specDir = rootDir === '' ? '' : basename(rootDir);

  const healQueue: ClassifiedFailure[] = [];
  const skipped: ClassifiedFailure[] = [];
  let totalTests = 0;
  let failedTests = 0;

  // Recursive depth-first traversal of suites
  function processSuite(suite: RawSuite): void {
    // Process specs in this suite
    if (suite.specs) {
      for (const spec of suite.specs) {
        if (spec.tests) {
          for (const test of spec.tests) {
            totalTests++;

            // Skip non-unexpected tests
            if (test.status !== 'unexpected') {
              continue;
            }

            failedTests++;

            // Get last result
            const results = test.results ?? [];
            const result = results.length > 0 ? results[results.length - 1] : undefined;

            const fullText = result === undefined ? '' : collectErrorText(result);
            const classified = classifyErrorText(fullText);

            // Build specFile: repo-relative path with forward slashes
            let specFile = spec.file ?? '';
            if (specDir !== '') {
              specFile = `${specDir}/${specFile}`;
            }

            const failure: ClassifiedFailure = {
              specFile,
              testName: spec.title ?? '',
              projectName: test.projectName ?? '',
              classification: classified.classification,
              rule: classified.rule,
              selector: classified.selector,
              errorText: clampErrorText(fullText),
              signals: classified.signals,
            };

            if (classified.classification === 'selector-drift') {
              healQueue.push(failure);
            } else {
              skipped.push(failure);
            }
          }
        }
      }
    }

    // Recurse into nested suites
    if (suite.suites) {
      for (const nestedSuite of suite.suites) {
        processSuite(nestedSuite);
      }
    }
  }

  // Process all suites
  if (raw.suites) {
    for (const suite of raw.suites) {
      processSuite(suite);
    }
  }

  return { totalTests, failedTests, healQueue, skipped };
}

// ============================================================================
// CLASSIFY RESULTS FILE
// ============================================================================

export async function classifyResultsFile(
  resultsPath?: string,
): Promise<ClassificationReport> {
  const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const target = resolve(REPO_ROOT, resultsPath ?? DEFAULT_RESULTS_PATH);

  let fileContent: string;
  try {
    fileContent = await readFile(target, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read Playwright results at ${target}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot parse Playwright results at ${target}: ${message}`);
  }

  return classifyFailures(parsed);
}

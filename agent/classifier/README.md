# Failure Classifier

Rule-based triage of Playwright test failures into a heal queue and a skipped list. The classifier is model-free and deterministic: it reads a Playwright JSON report and splits failures into two disjoint sets based on error signatures alone.

## Purpose

The classifier is the first step in the self-healing agent loop. It reads a Playwright JSON report produced by `npm run test:e2e` and routes each failure to either:

- **Heal queue** — failures carrying `classification: 'selector-drift'`, each with the original selector extracted from the error text and ready for the agent to attempt a fix.
- **Skipped list** — failures carrying `classification: 'other'`, each with a machine-readable reason code explaining why they are not worth investigating.

**Why rule-based?** From DESIGN.md: "failure classification is rule-based to keep the cost of the healing loop bounded" — every decision is made by matching observable error signatures, never by calling a model. Classification is synchronous, deterministic, and makes no network requests.

## Public API

```typescript
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

export const DEFAULT_RESULTS_PATH: string;
export const MAX_ERROR_TEXT_CHARS: number;
export const CLASSIFICATION_RULE_ORDER: readonly ClassificationRuleId[];

export function stripAnsi(text: string): string;
export function extractSelector(errorText: string): string | null;
export function collectErrorSignals(errorText: string): ErrorSignals;
export function classifyErrorText(errorText: string): ErrorClassification;
export function classifyFailures(report: unknown): ClassificationReport;
export function classifyResultsFile(resultsPath?: string): Promise<ClassificationReport>;
```

## Classification Rules

Applied in this **exact order** to every error text; first matching rule wins:

| # | Rule ID | Condition | Result |
| --- | --- | --- | --- |
| 1 | `strict-mode-violation` | `strict mode violation` appears in error | `selector-drift` |
| 2 | `no-error-output` | error text is empty after trim | `other` |
| 3 | `navigation-failure` | `page.goto:` or `net::ERR_` or `NS_ERROR_` in error | `other` |
| 4 | `page-exception` | first line is `ReferenceError`, `TypeError`, etc. | `other` |
| 5 | `element-resolved` | `locator resolved to` appears in error | `other` |
| 6 | `element-not-found` | `element(s) not found` or `resolved to 0 elements` appears | `selector-drift` |
| 7 | `timeout-waiting-for-locator` | `waiting for locator(` AND `Timeout \d+ms exceeded` both present | `selector-drift` |
| 8 | `test-timeout` | `Test timeout of \d+ms exceeded` appears | `other` |
| 9 | `unrecognized` | none of the above | `other` |

**Post-check:** If the classification is `selector-drift` but no selector literal could be extracted from the error, downgrade to `other` with rule `selector-not-extractable`.

## Selector Extraction

The classifier extracts the original selector from the error text by trying these four strategies in order; first match wins:

1. **Locator: line.** Split the error into lines. For the first line matching `Locator: …`, attempt to parse a `locator('…')` literal from it. If the line contains a valid quoted locator, extract and return it.

2. **Call log.** Search the full text for `waiting for locator('…')` or `waiting for locator("…")`. Return the first selector found.

3. **Anywhere.** Search the full text for any `locator('…')` or `locator("…")` literal. Return the first one found.

4. **No selector.** Return `null`.

All ANSI escape sequences are stripped before matching. The captured text is returned **verbatim** — no unescaping, no trimming of the captured value, no quote normalisation. Escaped quotes inside the selector (e.g., `button:has-text("Sign In")`) are preserved exactly.

## Why Scenario 5 Is `selector-drift`

Scenario 5 in the baseline suite is `#remember-me`, an element deliberately removed. The error is:

```
Error: expect(locator).toBeVisible() failed
Locator: locator('#remember-me')
Expected: visible
Timeout: 5000ms
Error: element(s) not found
```

This is indistinguishable from scenario 3 (element hidden, selector drifted) or scenario 4 (element text changed) by error text alone. It carries the exact same observable signals: a selector in the error, no `locator resolved to` line, and an `element(s) not found` marker.

**The classifier cannot and must not use knowledge that the element was deleted.** The system's proof that "the agent knows when to stop" comes from the **agent loop** (Task 3.3) failing to find a verified fix for scenario 5, not from the classifier pre-judging the case. A classifier that special-cases scenario 5 as `other` would be using out-of-band knowledge the error text does not carry — cheating.

All five seeded scenarios classify as `selector-drift` at this stage. Their fixability is determined later.

## Running Standalone

Start the app (if needed):
```sh
npm run start:app                                            # in another shell
```

Contract form — stdout is exactly the tool's output:
```sh
npx tsx agent/classifier/cli/classify-failures.cli.ts
npx tsx agent/classifier/cli/classify-failures.cli.ts --json
npx tsx agent/classifier/cli/classify-failures.cli.ts --results=custom/path/results.json
```

Convenience form — note `--silent`, which suppresses npm's script banner:
```sh
npm run --silent classify:failures
npm run --silent classify:failures -- --json
npm run --silent classify:failures -- --results=custom/path/results.json
```

Without `--silent`, `npm` prepends a `> pkg@version script` banner to **stdout**, so `npm run classify:failures -- --json` does not produce parseable JSON. That is npm's output, not the tool's. Do not add a `.npmrc` to work around it.

**Exit codes:**
- `0` = a report was produced (whether or not anything failed)
- `2` = CLI usage error (bad flag, unexpected argument)
- `1` = the results file could not be read or parsed

This **differs from `run_single_test`**, which exits `3` to distinguish verification failure from other errors. The classifier is a reporter, not a gate — it always produces a result or fails cleanly.

## Fixtures

Two committed JSON fixtures represent a broken run and a pristine run:

- `__fixtures__/broken-run.results.json` — captured after `npm run break:on && npm run test:e2e` (all 5 tests fail)
- `__fixtures__/pristine-run.results.json` — captured after `npm run break:off && npm run test:e2e` (all 5 tests pass)

**Fixtures are byte-verbatim copies of `test-results/results.json` generated by the Playwright JSON reporter.**

To re-capture after changes to the spec or app:

```sh
npm run break:off
npm run test:e2e
cp test-results/results.json agent/classifier/__fixtures__/pristine-run.results.json

npm run break:on
npm run test:e2e ; echo done
cp test-results/results.json agent/classifier/__fixtures__/broken-run.results.json
npm run break:off
```

**Playwright version:** ^1.62.1 (from `package.json`)

**Never hand-edit fixtures.** A fixture is a snapshot of the real reporter output. If the suite or the app changes, the fixture must be re-captured, never manually adjusted.

## Known Limitations (v1)

1. **Nested testDir produces wrong specFile.** The classifier derives `specFile` as `basename(config.rootDir) + '/' + spec.file`, so it works correctly with `testDir: './tests'` but would fail with `testDir: './e2e/specs'`. Limitation recorded; not a blocker for the baseline suite.

2. **Chained locators yield only the first literal.** A locator like `page.locator('#a').locator('#b')` produces an error mentioning only `#a`, not both. The extraction priority favours the line with the `Call log:` marker, which is the one that timed out.

3. **Escaped quotes are returned verbatim.** A selector containing `\'` is returned as `\'`, not unescaped to `'`. This is defensive — it preserves the literal token that occurs in the error, making it reproducible in a substitution.

4. **Only `status === 'unexpected'` counts as a failure.** Skipped, expected, and flaky tests are not classified. This is correct: only unexpected failures need investigation.

5. **getBy\* locators do not produce a `locator(…)` literal.** Methods like `getByRole('button')` do not appear in error messages as quoted strings, so they classify as `selector-not-extractable`. The baseline suite forbids `getBy*` (Task 1.2 decision 2), so this is not a limitation in practice.

## Not In This Component

- **Model/LLM integration.** No language-model client, no credential/API-key handling, no outbound network calls. Task 3.2.
- **Proposing or ranking selectors.** Extraction of the *original* selector is the only selector work. Task 3.2 handles proposals.
- **Confidence scoring.** Task 3.4 computes `high`, `low`, `none` from observable signals; the classifier does not assign confidence.
- **DOM access.** The classifier only reads the JSON report.
- **Spec file reading or editing.** No verification that the extracted selector occurs in the spec.
- **Test execution.** The classifier never spawns Playwright or invokes `run_single_test`.
- **Persistence.** Task 4.2 writes the `ClassificationReport` to a database.
- **PR creation.** Task 5.1 creates GitHub PRs from heals.

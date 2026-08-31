# Agent Tools

This directory contains deterministic, model-free tools that support the self-healing agent loop. Each tool is usable standalone with no model dependency and is tested before integration into the agent.

## get_dom_snapshot

The first of three tools. Produces a pruned, token-bounded HTML snapshot of the app under test.

### Public API

```typescript
export function estimateTokens(text: string): number;

export async function getDomSnapshot(
  page: import('@playwright/test').Page,
  overrides?: Partial<DomSnapshotOptions>,
): Promise<DomSnapshot>;

export async function captureDomSnapshotFromUrl(
  url: string,
  overrides?: Partial<DomSnapshotOptions>,
): Promise<DomSnapshot>;

export interface DomSnapshot {
  readonly url: string;
  readonly html: string;
  readonly estimatedTokens: number;
  readonly elementCount: number;
  readonly depthLimit: number | null;
  readonly truncated: boolean;
  readonly capturedAt: string;
}

export interface DomSnapshotOptions {
  readonly removeTags: readonly string[];
  readonly keepAttributes: readonly string[];
  readonly maxTextLength: number;
  readonly maxAttributeLength: number;
  readonly tokenCeiling: number;
  readonly depthLadder: readonly number[];
}
```

### Token Ceiling

**`DOM_SNAPSHOT_TOKEN_CEILING = 4000`**

The snapshot uses a fast heuristic to estimate token count: `estimateTokens(html) = ceil(html.length / 4)`. This is not a real tokenizer; it is a cheap approximation with large headroom to absorb error.

**Measured output for pristine `app-under-test/` at `/`:**
- Character count: **2192**
- Element count: **37**
- Estimated tokens: **548**

This is well under the ceiling, so the snapshot is never truncated on normal operation.

### Prune Rules

The snapshot is taken by cloning the live DOM in the browser and pruning it according to these rules:

**Removed tags** (entire subtree dropped):
`script`, `style`, `noscript`, `template`, `svg`, `canvas`, `iframe`, `link`, `meta`, `base`, `object`, `embed`, `audio`, `video`

**Kept attributes** (in addition to all `aria-*` attributes):
`id`, `class`, `role`, `type`, `name`, `href`, `src`, `alt`, `title`, `placeholder`, `value`, `for`, `disabled`, `checked`, `selected`, `readonly`, `required`, `hidden`, `tabindex`, `lang`, `action`, `method`, `rel`, `target`

**Dropped by default** (not in keep-list):
- All `data-*` attributes
- All `style=` attributes
- All `on*` event handlers

**Other transformations:**
- Comments are removed
- Text nodes are normalized (whitespace collapsed to single space)
- Text longer than 200 characters is truncated with `…`
- Attribute values longer than 120 characters are truncated with `…`
- Attribute values starting with `data:` are collapsed to the literal string `data:`

### Budget Enforcement

The depth ladder is a fixed-length array of max-depth limits tried in order: `[1000, 24, 16, 12, 10, 8, 6, 4, 2]`.

When the serialized HTML exceeds the token ceiling, we try the next rung (smaller depth). If even the shallowest rung exceeds the ceiling, we return that result with `truncated: true`.

**Critical guarantee:** The output is never truncated mid-string. It is always well-formed HTML. The depth ladder ensures we fall back to progressively shallower trees, not string slicing.

### Why `dom-prune.js` is JavaScript, not TypeScript

The `pruneDocument` function is shipped to the browser by `page.evaluate()` via `Function.prototype.toString()`, so it must be self-contained — with no imports, no module-scope constants, and no closure over external identifiers.

`tsx` runs esbuild with `keepNames: true` and transpiles `.ts` files through the CommonJS path, which injects `__name(f, "f")` wrapper calls into every named nested function. These `__name` calls do not exist in the browser context and cause a `ReferenceError` at runtime when the evaluated function tries to call them.

By using `.js` + `"type": "module"` in `package.json`, the file routes through the ESM transform path, which leaves the function body intact and self-contained.

**Do not rename this file to `.ts`, and do not "fix" a `__name` error by defining `globalThis.__name`.** Both would violate the self-containment guarantee. The types are declared in the adjacent `dom-prune.d.ts`.

### Running Standalone

Start the app (if needed):
```sh
npm run start:app                                            # in another shell
```

Contract form — stdout is exactly the tool's output:
```sh
npx tsx agent/tools/cli/get-dom-snapshot.cli.ts              # defaults to http://localhost:3100/
npx tsx agent/tools/cli/get-dom-snapshot.cli.ts --json
npx tsx agent/tools/cli/get-dom-snapshot.cli.ts http://localhost:3100/ > snapshot.html
```

Convenience form — note `--silent`, which suppresses npm's script banner:
```sh
npm run --silent tool:dom-snapshot
npm run --silent tool:dom-snapshot -- --json

npm run break:on && npm run --silent tool:dom-snapshot       # see the drifted DOM
npm run break:off
```

Without `--silent`, `npm` prepends a `> pkg@version script` banner to **stdout**, so `npm run tool:dom-snapshot -- --json` does not produce parseable JSON. That is npm's output, not the tool's. Do not add a `.npmrc` to work around it.

### Known Limitations (v1)

1. **Whitespace collapsing.** All whitespace is normalized uniformly, including inside `<pre>`. Pure-whitespace text nodes between inline elements are dropped, so inter-element spacing is not preserved visually when the snapshot is re-parsed.

2. **Shadow DOM and iframes.** Content in Shadow DOM and same-origin iframes is not captured; only the main document is snapshotted.

3. **No data-testid.** The `data-testid` attribute is stripped along with all other `data-*` attributes (see rationale in design docs).

4. **DOM at navigation.** The snapshot is taken from a page the caller navigated (via `page.goto()`), not from a frozen artifact of the failing test run. This is sufficient for all five seeded scenarios because they only set form values, which are stored in the DOM `value` property, not markup.

### Not In This Tool

- **Task 2.2** (`query_selector`): No match counting, no text previews.
- **Task 2.3** (`run_single_test`): No test execution, no spec file copying.
- **Task 3** (Agent loop): No model/LLM integration, no confidence scoring.
- **Real tokenizer:** The estimate is a heuristic.
- **HTML parser dependency:** The browser itself is the parser.

## query_selector

The second of three tools. Reports how many elements a candidate selector resolves to, and what each matched element is, without committing to any fix.

### Public API

```typescript
export type SelectorErrorKind = 'invalid-selector' | 'evaluation-failed';

export interface SelectorError {
  readonly kind: SelectorErrorKind;
  readonly message: string;
}

export interface SelectorMatchPreview {
  readonly index: number;
  readonly tagName: string;
  readonly id: string | null;
  readonly classList: readonly string[];
  readonly role: string | null;
  readonly text: string;
  readonly visible: boolean;
}

export interface QuerySelectorOptions {
  readonly maxPreviews: number;
  readonly maxPreviewTextLength: number;
}

export interface QuerySelectorResult {
  readonly selector: string;
  readonly matchCount: number;
  readonly previews: readonly SelectorMatchPreview[];
  readonly previewsTruncated: boolean;
  readonly error: SelectorError | null;
}

export async function querySelector(
  page: import('@playwright/test').Page,
  selector: string,
  overrides?: Partial<QuerySelectorOptions>,
): Promise<QuerySelectorResult>;

export async function querySelectorFromUrl(
  selector: string,
  url: string,
  overrides?: Partial<QuerySelectorOptions>,
): Promise<QuerySelectorResult>;
```

### Selector Dialect

Selectors go through `page.locator()`, so the tool supports Playwright's selector engine syntax in addition to CSS. This includes Playwright pseudo-classes like `:has-text()`, `text=`, `>>`, and others. Selectors are sent verbatim to the tool from spec files, and the baseline suite's scenario-4 target is `button:has-text("Sign In")`, a Playwright engine pseudo-class that `document.querySelectorAll` rejects. The tool must support the dialect the spec files are written in.

### Bounds

**`QUERY_SELECTOR_MAX_PREVIEWS = 10`**

**`QUERY_SELECTOR_MAX_PREVIEW_TEXT_LENGTH = 80`**

`matchCount` is always the true count of matched elements, even when `previews` is capped at 10. `previewsTruncated` indicates whether any elements were omitted from the preview list.

### Errors

The tool never rejects a Promise for a bad selector; all errors are structured results:

| Situation | `matchCount` | `previews` | `error` | Call rejects? |
| --- | --- | --- | --- | --- |
| 0 matches | `0` | `[]` | `null` | no |
| 1+ matches | true count | up to 10 | `null` | no |
| empty / whitespace selector | `0` | `[]` | `invalid-selector` | no |
| unparseable selector | `0` | `[]` | `invalid-selector` | no |
| browser evaluation failed | phase-1 count | `[]` | `evaluation-failed` | no |

**`querySelector` never rejects for a bad selector.** Zero matches is not an error. An invalid selector is feedback to the model, not a CLI crash.

### Read-only Guarantee

The tool only counts and reads; it never clicks, hovers, scrolls, fills, waits, or retries. The page is unchanged before and after a `querySelector()` call. A test asserts that `document.documentElement.outerHTML` is identical before and after.

### Why `selector-preview.js` is JavaScript, not TypeScript

The `describeElements` function is shipped to the browser by `locator.evaluateAll()` via `Function.prototype.toString()`, so it must be self-contained — with no imports, no module-scope constants, and no closure over external identifiers.

`tsx` runs esbuild with `keepNames: true` and transpiles `.ts` files through the CommonJS path, which injects `__name(f, "f")` wrapper calls into every named nested function. These `__name` calls do not exist in the browser context and cause a `ReferenceError` at runtime when the evaluated function tries to call them.

By using `.js` + `"type": "module"` in `package.json`, the file routes through the ESM transform path, which leaves the function body intact and self-contained.

**Do not rename this file to `.ts`, and do not "fix" a `__name` error by defining `globalThis.__name`.** Both would violate the self-containment guarantee. The types are declared in the adjacent `selector-preview.d.ts`. See the `dom-prune.js` section for the same pattern.

### Running Standalone

Start the app (if needed):
```sh
npm run start:app                                            # in another shell
```

Contract form — stdout is exactly the tool's output:
```sh
npx tsx agent/tools/cli/query-selector.cli.ts '#login-btn'
npx tsx agent/tools/cli/query-selector.cli.ts '.nav-link' --json
npx tsx agent/tools/cli/query-selector.cli.ts 'button:has-text("Sign In")' --url=http://localhost:3100/
```

Convenience form — note `--silent`, which suppresses npm's script banner:
```sh
npm run --silent tool:query-selector -- '#login-btn'
npm run --silent tool:query-selector -- '#login-btn' --json
```

Without `--silent`, `npm` prepends a `> pkg@version script` banner to **stdout**, so `npm run tool:query-selector -- --json` does not produce parseable JSON. That is npm's output, not the tool's. Do not add a `.npmrc` to work around it.

**Exit codes:**
- `0` = a result was produced (including a structured `error`)
- `2` = CLI usage error
- `1` = browser launch or navigation failure

### Known Limitations (v1)

1. **Implicit ARIA roles are not computed.** `role` is the literal `role` attribute only. A `<button>` with no explicit role attribute reports `role: null`, even though its implicit ARIA role is `button`.

2. **`classList` is not capped.** An element with a very large class list produces a large preview. Not a problem for the app under test (max 2 classes per element).

3. **Only the main frame is queried.** Shadow DOM piercing is whatever `page.locator()` does by default; no extra traversal is implemented.

4. **`visible` is a point-in-time read.** The tool does not wait for anything to appear; a selector that would match after a 2-second animation is reported as 0 matches (or as hidden matches if they exist offscreen).

### Not In This Tool

- **Selector *generation* or ranking.** This tool evaluates a candidate the caller supplies. It does not propose alternatives, score similarity, or suggest "did you mean".
- **Test execution or spec-file editing** (Task 2.3).
- **Tool-schema registration** (Phase 3): No model/LLM integration, no confidence scoring.
- **Confidence scoring.** `matchCount` is an input to the Phase 3 confidence gate; the gate itself is Task 3.4.
- **Persistence.** No database, no writing results anywhere.

## run_single_test

The third and final deterministic tool. Verifies a candidate selector by substituting it into a temporary copy of the spec file, running the real test via Playwright, and examining the JSON report. **A fix is only ever accepted because the test was re-executed and passed.**

### Public API

```typescript
export async function runSingleTest(
  input: RunSingleTestInput,
): Promise<RunSingleTestResult>;

export async function verifySpecSource(
  input: VerifySpecSourceInput,
): Promise<RunSingleTestResult>;

export function applySelectorSubstitution(
  originalSource: string,
  originalSelector: string,
  candidateSelector: string,
): SubstitutionResult;

export function checkAssertionIntegrity(
  originalSource: string,
  proposedSource: string,
  allowedLiteralChange: AllowedLiteralChange | null,
): AssertionIntegrityResult;

export function diffChangedLines(
  originalSource: string,
  proposedSource: string,
): readonly SpecLineChange[];

export interface RunSingleTestInput {
  readonly specFile: string;
  readonly testName: string;
  readonly originalSelector: string;
  readonly candidateSelector: string;
  readonly timeoutMs?: number;
}

export interface VerifySpecSourceInput {
  readonly specFile: string;
  readonly testName: string;
  readonly proposedSource: string;
  readonly allowedLiteralChange: AllowedLiteralChange | null;
  readonly timeoutMs?: number;
}

export interface RunSingleTestResult {
  readonly passed: boolean;
  readonly output: string;
  readonly executed: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly rejected: VerificationRejection | null;
  readonly violations: readonly IntegrityViolation[];
  readonly specFile: string;
  readonly testName: string;
  readonly originalSelector: string;
  readonly candidateSelector: string;
  readonly proposedSource: string | null;
  readonly changedLines: readonly SpecLineChange[];
  readonly durationMs: number;
}

export interface SubstitutionResult {
  readonly ok: boolean;
  readonly proposedSource: string | null;
  readonly fromLiteral: string | null;
  readonly toLiteral: string | null;
  readonly occurrences: number;
  readonly failure: SubstitutionFailure | null;
  readonly detail: string;
}

export interface AssertionIntegrityResult {
  readonly ok: boolean;
  readonly violations: readonly IntegrityViolation[];
}

export interface IntegrityViolation {
  readonly rule: IntegrityRuleId;
  readonly detail: string;
}

export interface SpecLineChange {
  readonly lineNumber: number;
  readonly before: string;
  readonly after: string;
}
```

### The Pipeline

1. Read original spec and compute its SHA-256 hash
2. Substitute the candidate selector for the original (single exact string-literal replacement)
3. **Integrity gate** (runs before anything is written or spawned):
   - Rule-based checks on raw source that reject any removal, weakening, or skipping of assertions
   - `executed: false` in the result is the observable proof that nothing was written
4. Write proposed source to a temp directory (`mend-tmp/run-XXXXXX/`)
5. Spawn a real `playwright test` child process with the temp copy
6. Collect stdout and stderr, parse the JSON report
7. Re-read the original and verify its hash is unchanged
8. Delete the temp directory in a `finally` block

### How `passed` Is Decided

```
passed = exitCode === 0
  && !timedOut
  && stats.expected === 1
  && stats.unexpected === 0
  && stats.flaky === 0
  && stats.skipped === 0
```

`passed` is computed from the child's exit code, timeout flag, and the JSON report's stats object. It is **never** derived from parsing stdout for `"1 passed"` or any human-readable text. `retries: 0` in `playwright.verify.config.ts` ensures a flaky pass cannot be recorded as a heal.

### Assertion Integrity

The integrity gate rejects the proposed source **before any child process is spawned** if any of these eight rules are violated:

| # | Rule | Pattern | Violation |
| --- | --- | --- | --- |
| 1 | `expect-count` | `/\bexpect\s*\(/g` | proposed count **<** original |
| 2 | `matcher-inventory` | for each of 45 Playwright matchers | any proposed count **≠** original |
| 3 | `negation-count` | `/\.not\b/g` | proposed count **≠** original |
| 4 | `await-count` | `/\bawait\b/g` | proposed count **≠** original |
| 5 | `skip-only` | `/\.\s*(?:skip\|only\|fixme\|fail\|soft)\b/g` | proposed count **>** original |
| 6 | `comment-count` | `/\/\/\|\/\*/g` | proposed count **>** original |
| 7 | `line-count` | `source.split('\n').length` | proposed count **≠** original |
| 8 | `string-literals` | multiset comparison via regex | unexpected changes except the allowed selector substitution |

#### What This Stops

The gate prevents:
- Deleting an assertion line entirely (rules 1, 7)
- Commenting out an assertion (rule 6)
- Adding `test.skip()`, `test.only()`, `.soft()` (rule 5)
- Swapping a strict matcher for a loose one (rule 2)
- Adding or removing `.not` (rule 3)
- Dropping an `await` before a promise (rule 4)
- Changing an expected-value string literal to something weaker (rule 8)

`forbidOnly: true` in `playwright.verify.config.ts` is a second, independent line of defence against `.only`.

### Candidate Selector Safety

Before substitution is attempted, the candidate selector is validated for injection attacks:

- **Empty or whitespace:** rejected as `unsafe-candidate-selector`
- **Exceeds 200 characters:** rejected as `unsafe-candidate-selector`
- **Contains a forbidden substring** (`\n`, `\r`, `\`, `` ` ``, `${`): rejected as `unsafe-candidate-selector`
- **Identical to the original:** rejected as `candidate-identical-to-original`
- **Contains both `'` and `"`:** rejected as `unsafe-candidate-selector` (disqualifies it from being safely quoted)

A candidate containing `#x'); test.skip(); ('` is rejected, never reaches the source.

### The Temp Copy

Each call creates a unique directory at `mend-tmp/run-XXXXXX/` (repo root, gitignored), containing a single copy of the spec file with the proposed selector substituted. Nothing is ever written into `tests/`. The original is hashed before and after every call; if the post-call hash differs, `rejected: 'original-spec-mutated'` and `passed: false`. The root `mend-tmp/` directory itself is durable — created on demand, never removed — and an empty `mend-tmp/` remaining in the working tree is the expected steady state, the same way Playwright leaves `test-results/` behind.

### Bounds

- **Timeout:** `RUN_SINGLE_TEST_TIMEOUT_MS = 90_000` (90 seconds); overrideable per call
- **Output clamping:** `RUN_SINGLE_TEST_MAX_OUTPUT_CHARS = 8_000` (head + tail of child output)
- **One child process** per call, killed at the timeout with `SIGKILL`
- **Zero retries:** `playwright.verify.config.ts` sets `retries: 0`

### Rejection Codes

| Rejection Code | When It Occurs | `executed` |
| --- | --- | --- |
| `spec-file-unreadable` | spec path cannot be read at the start | `false` |
| `unsafe-candidate-selector` | candidate fails the injection validation | `false` |
| `candidate-identical-to-original` | candidate === original | `false` |
| `selector-not-found` | original selector literal not found in spec source | `false` |
| `selector-ambiguous` | original selector occurs more than once in source | `false` |
| `assertion-integrity` | integrity gate violation detected | `false` |
| `original-spec-mutated` | original file's hash changed after the call | `true` |
| `results-unavailable` | child ran but JSON report could not be read or parsed | `true` |

### Running Standalone

Start the app (if needed):
```sh
npm run start:app                                            # in another shell
```

Contract form — stdout is exactly the tool's output:
```sh
npx tsx agent/tools/cli/run-single-test.cli.ts \
  --spec=tests/login-submit.spec.ts \
  --test='submitting valid credentials updates the login status' \
  --original='#login-btn' --candidate='#login-form #login-btn'

npx tsx agent/tools/cli/run-single-test.cli.ts --spec=... --test=... \
  --original=... --candidate=... --json
```

Convenience form — note `--silent`, which suppresses npm's script banner:
```sh
npm run --silent tool:run-single-test -- --spec=tests/login-submit.spec.ts \
  --test='submitting valid credentials updates the login status' \
  --original='#login-btn' --candidate='#login-form #login-btn'
```

**Exit codes:**
- `0` = verification **passed**
- `3` = a result was produced but verification did **not** pass (executed and failed, or rejected before execution)
- `2` = CLI usage error (missing or empty required argument)
- `1` = the tool itself threw (spec file cannot be read, spawn failure, etc.)

This **differs from `query_selector`**, which exits `0` for any produced result including a structured error. Here, `run_single_test` is the verification gate — its exit code must distinguish success (`0`) from any form of failure (`3` or lower). A shell script doing `run-single-test ... && mark_healed` must not mark a heal when the test failed.

Without `--silent`, `npm` prepends a `> pkg@version script` banner to **stdout**, so `npm run tool:run-single-test -- --json` does not produce parseable JSON. That is npm's output, not the tool's. Do not add a `.npmrc` to work around it.

### Known Limitations (v1)

1. **Temp directory, not beside the original.** The temp copy lives at `mend-tmp/run-XXXXXX/`, not alongside the original in `tests/`. A spec that imports a relative helper (`../fixtures/helper.ts`) would fail to resolve. All baseline specs import only `@playwright/test`, so this limitation has zero impact today and is recorded as a documented v1 constraint.

2. **Single quoted string literal, exactly once.** The selector must appear as a single quoted string literal occurring exactly once in the file. `tests/README.md` guarantees this for the baseline suite. Selectors built by concatenation, template interpolation, or held in shared constants are not supported.

3. **Regex-based gate, not AST-based.** The integrity gate uses pattern matching on raw source, not an abstract syntax tree. Occurrence counts include text inside strings and comments. Because every rule compares the *same* function's output on both sources, this biases strictly toward false **rejection**, never false acceptance.

4. **Regex-based literal extraction.** `extractStringLiterals` does not handle nested template-literal interpolation. Candidates containing `${` are rejected outright, so this cannot be exploited.

5. **One test, one title.** Only one test is selected per call via `--grep` on the exact title. A duplicate test title in the same file would match two tests and `passed` would be `false` (`stats.expected === 2`).

### Not In This Tool

- **Selector generation or repair suggestions.** This tool verifies a candidate the caller supplies. It never proposes one.
- **Failure classification** (Task 3.1) or confidence scoring (Task 3.4). `passed`, `executed` and `violations` are inputs to those phases.
- **Persistence.** No database, no writing results anywhere except stdout and the transient temp directory.
- **PR creation, branches, commits, or Octokit** (Task 5.1).
- **Modifying the baseline suite.** `tests/`, `app-under-test/`, and `breakage/` are never edited under any circumstances.
- **LLM integration.** No tool-schema registration (Phase 3), no API key handling.

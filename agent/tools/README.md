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

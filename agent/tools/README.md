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

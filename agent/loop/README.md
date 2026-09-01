# agent/loop

A hand-rolled OpenAI tool-calling loop that consumes one `ClassifiedFailure` and returns a `HealResult`. The loop never uses an agent framework — DESIGN.md states "OpenAI API with native tool calling … No agent framework. The loop is ~100 lines of explicit control flow" — because explicit control flow makes the verification gate and the hard cap both visible and testable without a network.

## The verification gate

**Non-negotiable invariant.** `HealResult.proposedSelector` is non-null **only** when a `run_single_test` tool call has returned `passed === true`. The single assignment to `verifiedFix` in `heal-loop.ts` is guarded by exactly this condition, and `assertHealInvariant` enforces it on every return path. Model confidence alone is never sufficient. A model that asserts "the correct selector is `#signin-button`" in prose without calling `run_single_test`, or calls it and receives `passed: false`, will yield `proposedSelector: null` and `outcome: 'no-fix'`.

## The hard cap

`MAX_TOOL_CALLS = 5`. The counter increments **before** tool execution, not after and not only on success. An unknown tool name, malformed JSON arguments, and a tool that throws all consume one of the five. Once the cap is reached, no further model request is made — this is the only way to avoid paying for a request that cannot act. `maxToolCalls` in `HealDeps` can only lower the cap, never raise it (`Math.min(deps.maxToolCalls ?? MAX_TOOL_CALLS, MAX_TOOL_CALLS)`). `MAX_MODEL_TURNS = 6`.

## Public API

```ts
export interface ToolSchema {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface AssistantToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly tool_calls?: readonly AssistantToolCall[];
    }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };

export interface ModelUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}

export interface ModelRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSchema[];
}

export interface ModelResponse {
  readonly content: string | null;
  readonly toolCalls: readonly ModelToolCall[];
  readonly finishReason: string;
  readonly usage: ModelUsage | null;
}

export interface ModelClient {
  readonly model: string;
  createCompletion(request: ModelRequest): Promise<ModelResponse>;
}

export type HealToolName = 'get_dom_snapshot' | 'query_selector' | 'run_single_test';

export interface HealToolbox {
  getDomSnapshot(): Promise<DomSnapshot>;
  querySelector(selector: string): Promise<QuerySelectorResult>;
  runSingleTest(candidateSelector: string): Promise<RunSingleTestResult>;
}

export interface ToolArgumentsParseResult {
  readonly ok: boolean;
  readonly args: Record<string, unknown>;
  readonly value: string | null;
  readonly error: string | null;
}

export type ToolCallResult =
  | {
      readonly kind: 'dom-snapshot';
      readonly url: string;
      readonly html: string;
      readonly estimatedTokens: number;
      readonly elementCount: number;
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'query-selector';
      readonly selector: string;
      readonly matchCount: number;
      readonly previews: readonly unknown[];
      readonly previewsTruncated: boolean;
      readonly error: { readonly kind: string; readonly message: string } | null;
    }
  | {
      readonly kind: 'run-single-test';
      readonly candidate: string;
      readonly passed: boolean;
      readonly executed: boolean;
      readonly rejected: string | null;
      readonly violations: readonly { readonly rule: string; readonly detail: string }[];
      readonly changedLines: readonly SpecLineChange[];
      readonly output: string;
    }
  | { readonly kind: 'error'; readonly message: string };

export interface ToolCallRecord {
  readonly index: number;
  readonly toolCallId: string;
  readonly tool: string;
  readonly rawArguments: string;
  readonly arguments: Record<string, unknown>;
  readonly ok: boolean;
  readonly result: ToolCallResult;
  readonly resultSummary: string;
  readonly startedAt: string;
  readonly durationMs: number;
}

export interface ModelRequestRecord {
  readonly turn: number;
  readonly finishReason: string;
  readonly usage: ModelUsage | null;
  readonly contentPreview: string;
  readonly requestedTools: readonly string[];
}

export interface BootstrapSnapshot {
  readonly url: string;
  readonly html: string;
  readonly estimatedTokens: number;
  readonly elementCount: number;
  readonly truncated: boolean;
  readonly capturedAt: string;
}

export interface HealTranscript {
  readonly bootstrapSnapshot: BootstrapSnapshot | null;
  readonly messages: readonly ChatMessage[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly modelRequests: readonly ModelRequestRecord[];
}

export type HealOutcome = 'healed' | 'no-fix' | 'error';

export type HealStopReason =
  | 'verified-fix'
  | 'model-gave-up'
  | 'tool-call-cap-reached'
  | 'model-turn-limit-reached'
  | 'model-error'
  | 'toolbox-error'
  | 'invalid-input';

export interface VerifiedFix {
  readonly candidateSelector: string;
  readonly toolCallIndex: number;
}

export interface VerificationSummary {
  readonly candidateSelector: string;
  readonly passed: boolean;
  readonly executed: boolean;
  readonly rejected: string | null;
  readonly changedLines: readonly SpecLineChange[];
  readonly output: string;
  readonly durationMs: number;
}

export interface HealDeps {
  readonly model: ModelClient;
  readonly toolbox: HealToolbox;
  readonly appUrl: string;
  readonly maxToolCalls?: number;
}

export interface HealResult {
  readonly specFile: string;
  readonly testName: string;
  readonly originalSelector: string;
  readonly proposedSelector: string | null;
  readonly outcome: HealOutcome;
  readonly stopReason: HealStopReason;
  readonly verified: boolean;
  readonly toolCallCount: number;
  readonly capReached: boolean;
  readonly modelTurnCount: number;
  readonly verification: VerificationSummary | null;
  readonly transcript: HealTranscript;
  readonly model: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly errorMessage: string | null;
}

export const MAX_TOOL_CALLS: number;
export const MAX_MODEL_TURNS: number;
export function healFailure(failure: ClassifiedFailure, deps: HealDeps): Promise<HealResult>;
export function assertHealInvariant(result: HealResult): void;

export const HEAL_TOOL_NAMES: readonly HealToolName[];
export const HEAL_TOOL_SCHEMAS: readonly ToolSchema[];
export const MAX_TOOL_RESULT_CHARS: number;
export const MAX_TEST_OUTPUT_TAIL_CHARS: number;
export function isHealToolName(name: string): name is HealToolName;
export function parseToolArguments(tool: HealToolName, argumentsJson: string): ToolArgumentsParseResult;
export function summariseToolResult(result: ToolCallResult): string;

export const SYSTEM_PROMPT: string;
export function buildInitialMessages(
  failure: ClassifiedFailure,
  appUrl: string,
  snapshot: DomSnapshot,
): readonly ChatMessage[];

export const OPENAI_CHAT_COMPLETIONS_URL: string;
export const DEFAULT_HEAL_MODEL: string;
export const MODEL_REQUEST_TIMEOUT_MS: number;
export function resolveHealModel(): string;
export function createOpenAIClient(overrides?: {
  readonly model?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}): ModelClient;

export const DEFAULT_APP_URL: string;
export interface PlaywrightToolbox extends HealToolbox { close(): Promise<void>; }
export function createPlaywrightToolbox(
  failure: ClassifiedFailure,
  options?: { readonly appUrl?: string; readonly timeoutMs?: number },
): Promise<PlaywrightToolbox>;
```

## The three tools as the model sees them

| Name | Arguments | Result |
|------|-----------|--------|
| `get_dom_snapshot` | None (no arguments) | `{ url, estimatedTokens, elementCount, truncated, html }` — pruned HTML of the page at this moment, estimated tokens and element count, truncation flag |
| `query_selector` | `selector: string` | `{ selector, matchCount, previews, previewsTruncated, error }` — how many elements match, short previews of each, any selector error |
| `run_single_test` | `candidate: string` | `{ candidate, passed, executed, rejected, violations, changedLineCount, outputTail }` — whether the test passed, whether it executed, any integrity rejection, any assertion violations, and tail of test output |

The model supplies only a selector string (`selector` for `query_selector`, `candidate` for `run_single_test`). The `specFile`, `testName`, and `originalSelector` are bound at `PlaywrightToolbox` construction from the `ClassifiedFailure` and are never reachable from model-supplied arguments. Extra keys the model sends are preserved in the transcript for honesty but are otherwise ignored.

## Bootstrap DOM snapshot

One capture, taken before the first model request, embedded in the initial user message, and not counted against the cap. This bootstrap capture is exactly one fixed cost, model-free, and deterministic. It is recorded in `HealTranscript.bootstrapSnapshot` so the dashboard can still replay "the DOM the agent saw". The recommendation in the plan rationale (Q4) justifies this: it matches DESIGN.md's pipeline diagram literally and is the only reading consistent with the Task 3.4 confidence table, which requires "verified pass, exactly 1 DOM match, ≤ 2 tool calls" — achievable only as `query_selector` (gives match count) + `run_single_test` (gives verified pass) = 2 calls.

## Transcript shape

`HealTranscript` carries:
- `bootstrapSnapshot` — the pre-request DOM snapshot, or null on bootstrap failure
- `messages` — the full conversation in order, exactly as sent to the model
- `toolCalls` — every executed tool call in order; length always equals `HealResult.toolCallCount`
- `modelRequests` — one entry per model round trip, with finish reason, usage, and content preview

The transcript is JSON-serializable (`Date` objects are ISO-8601 strings, no `undefined`, no circular refs) and ready for Phase 4 `jsonb` storage without transformation.

## Termination reasons

| `HealStopReason` | `HealOutcome` | `proposedSelector` non-null? |
|---|---|---|
| `verified-fix` | `healed` | yes |
| `model-gave-up` | `no-fix` | no |
| `tool-call-cap-reached` | `no-fix` | no |
| `model-turn-limit-reached` | `no-fix` | no |
| `model-error` | `error` | no |
| `toolbox-error` | `error` | no |
| `invalid-input` | `error` | no |

## Running standalone

First, start the application server (required for the bootstrap DOM snapshot and the browser navigation):

```sh
npm run start:app
```

In a separate shell, export the API key (never add it to `.env` in a shared environment; use a shell-local export):

```sh
export OPENAI_API_KEY=sk-...
```

Then run the heal CLI:

```sh
npm run break:on
npm run test:e2e ; echo "exit=$?"        # Fail the tests and generate test-results/results.json
npm run --silent classify:failures       # Ensure the heal queue is non-empty
npm run --silent heal:one -- --spec=tests/login-submit.spec.ts ; echo "exit=$?"
```

To see the full transcript as JSON:

```sh
npm run --silent heal:one -- --spec=tests/login-submit.spec.ts --json | jq .
```

**Important:** `npm run --silent` suppresses npm's stdout banner. The `--silent` flag is required when piping the output or using `--json`.

Exit codes:
- `0` — a **verified** heal (`outcome: 'healed'` and `verified: true`)
- `3` — a result was produced but no verified fix (cap reached, model gave up, model error)
- `2` — CLI usage error
- `1` — could not produce a result (bad results file, no matching failure, missing API key, app not running)

Note: exit code `0` vs `3` follows the `run_single_test` gate convention, not the classifier convention.

## Model and cost

The loop uses `gpt-4o-mini` by default (`DEFAULT_HEAL_MODEL = 'gpt-4o-mini'`), overridable by the `MEND_OPENAI_MODEL` environment variable. Requests are sent with `temperature: 0` (for reproducibility) and `parallel_tool_calls: false`. Per-turn token usage is recorded in `HealResult.transcript.modelRequests[].usage` (fields: `promptTokens`, `completionTokens`, `totalTokens`).

## Known limitations (v1)

1. `DEFAULT_APP_URL` duplicates the base URL in the three Playwright configs; this is accepted as a v1 limitation rather than importing a config.
2. Only one failure is healed per invocation; no batching and no parallelism.
3. The loop is exercised against scenario 1 (renamed `id`) only — scenarios 2–5 (text drift, DOM restructure, missing element, genuine removal) are Task 3.3.
4. No retry on a model API error, by design; the cap applies equally to every path.
5. The bootstrap snapshot is taken from a freshly navigated page, inheriting the limitation of `get_dom_snapshot` (no login, no state setup).
6. The app server must already be running for the bootstrap snapshot, whereas `run_single_test` starts its own via `reuseExistingServer`.

## Not in this component

- **Confidence scoring** (Task 3.4) — no `high`/`low`/`none` value is computed.
- **Scenarios 2–5** (Task 3.3) — no text-drift, DOM-restructure, or missing-element logic.
- **Persistence** (Task 4.2) — no PostgreSQL, no `heal_attempts` row, no writing the transcript to disk.
- **PR creation** (Task 5.1) — no Octokit, no branches, no commits.
- **Dashboard, metrics** (Phases 6–7) — no aggregation of usage, no cost reporting surfaces.
- **Re-classification** — the loop consumes a `ClassifiedFailure`; it never inspects Playwright error text to decide what kind of failure it is.
- **Prompt-tuning harness, eval framework** — one system prompt, one message shape, no experiment infrastructure.

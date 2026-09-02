import type { DomSnapshot } from '../tools/get-dom-snapshot.js';
import type { QuerySelectorResult } from '../tools/query-selector.js';
import type { RunSingleTestResult, SpecLineChange } from '../tools/run-single-test.js';

// ---------- OpenAI wire shapes (deliberately mirror the API) ----------

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
  /** Verbatim JSON string from the model. May be malformed. */
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

// ---------- Tools ----------

export type HealToolName = 'get_dom_snapshot' | 'query_selector' | 'run_single_test';

/**
 * The only surface the model can reach. `runSingleTest` takes a candidate selector and
 * nothing else: the spec file, test name, and original selector are bound at construction
 * and are not model-controllable.
 */
export interface HealToolbox {
  getDomSnapshot(): Promise<DomSnapshot>;
  querySelector(selector: string): Promise<QuerySelectorResult>;
  runSingleTest(candidateSelector: string): Promise<RunSingleTestResult>;
}

export interface ToolArgumentsParseResult {
  readonly ok: boolean;
  /** The parsed arguments object, verbatim, including keys the tool ignores. `{}` on failure. */
  readonly args: Record<string, unknown>;
  /** The single string argument the tool needs. null for get_dom_snapshot and on failure. */
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

// ---------- Transcript ----------

export interface ToolCallRecord {
  /** 1-based, in execution order. Equals the tool-call count at the time of execution. */
  readonly index: number;
  readonly toolCallId: string;
  /** A HealToolName, or the verbatim unknown name the model sent. */
  readonly tool: string;
  /** Verbatim JSON string the model sent. */
  readonly rawArguments: string;
  /** Parsed arguments, including keys the tool ignored. `{}` when unparseable. */
  readonly arguments: Record<string, unknown>;
  /** False for unknown tool, bad arguments, or a tool that threw. */
  readonly ok: boolean;
  readonly result: ToolCallResult;
  /** The exact string sent back to the model as the tool message content. */
  readonly resultSummary: string;
  readonly startedAt: string;
  readonly durationMs: number;
}

export interface ModelRequestRecord {
  readonly turn: number;
  readonly finishReason: string;
  readonly usage: ModelUsage | null;
  /** First 500 characters of the assistant's text content. */
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
  /** The one snapshot captured before the first model request. null on bootstrap failure. */
  readonly bootstrapSnapshot: BootstrapSnapshot | null;
  /** The clamped spec source shown to the model. null when none was supplied. */
  readonly bootstrapSpecSource: string | null;
  /** The full conversation, in order, exactly as sent to the model. */
  readonly messages: readonly ChatMessage[];
  /** Every executed tool call, in order. Length always equals HealResult.toolCallCount. */
  readonly toolCalls: readonly ToolCallRecord[];
  /** One entry per model round trip. */
  readonly modelRequests: readonly ModelRequestRecord[];
}

// ---------- Result ----------

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
  /** Clamped to at most MAX_TOOL_CALLS. Can lower the cap, never raise it. */
  readonly maxToolCalls?: number;
  /**
   * The spec file's source, read by the caller. Read-only context for the model.
   * null when unavailable. `healFailure` never reads the filesystem itself.
   */
  readonly specSource?: string | null;
}

export interface HealResult {
  readonly specFile: string;
  readonly testName: string;
  readonly originalSelector: string;
  /** Non-null if and only if a run_single_test call returned passed === true. */
  readonly proposedSelector: string | null;
  readonly outcome: HealOutcome;
  readonly stopReason: HealStopReason;
  /** Identical to `proposedSelector !== null`. */
  readonly verified: boolean;
  /** Model-initiated tool calls executed. Never exceeds MAX_TOOL_CALLS. */
  readonly toolCallCount: number;
  readonly capReached: boolean;
  readonly modelTurnCount: number;
  /** The last run_single_test call's summary, passing or not. null if never called. */
  readonly verification: VerificationSummary | null;
  readonly transcript: HealTranscript;
  readonly model: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly errorMessage: string | null;
}

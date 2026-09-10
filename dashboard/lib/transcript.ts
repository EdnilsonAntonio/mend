import { formatJson } from './format';

/**
 * Source of truth: agent/loop/heal-loop.ts (MAX_TOOL_CALLS) and
 * db/migrations/0002_heal_attempts.sql (heal_attempts_tool_call_count_within_cap).
 * Re-declared here so the dashboard build does not depend on the agent module graph.
 */
export const TOOL_CALL_CAP = 5;

export const MAX_SNAPSHOT_RENDER_CHARS = 20_000;
export const MAX_OUTPUT_RENDER_CHARS = 10_000;
export const MAX_SPEC_SOURCE_RENDER_CHARS = 10_000;
export const MAX_ARGUMENTS_RENDER_CHARS = 2_000;
export const MAX_UNKNOWN_RENDER_CHARS = 4_000;
export const MAX_CHANGED_LINES_RENDERED = 50;
export const MAX_PREVIEWS_RENDERED = 10;

/**
 * Accessors for unknown values. Each is one expression, none throws.
 */

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asStringArray(value: unknown): readonly string[] {
  return asArray(value)
    .map((v) => asString(v))
    .filter((v): v is string => v !== null);
}

/**
 * View types for rendering.
 */

export interface DomSnapshotView {
  readonly url: string | null;
  readonly html: string;
  readonly estimatedTokens: number | null;
  readonly elementCount: number | null;
  readonly truncated: boolean;
  readonly capturedAt: string | null;
}

export interface SelectorPreviewView {
  readonly index: number | null;
  readonly tagName: string | null;
  readonly id: string | null;
  readonly classList: readonly string[];
  readonly role: string | null;
  readonly text: string;
  readonly visible: boolean | null;
}

export interface SpecLineChangeView {
  readonly lineNumber: number | null;
  readonly before: string;
  readonly after: string;
}

export interface IntegrityViolationView {
  readonly rule: string;
  readonly detail: string;
}

export interface SelectorErrorView {
  readonly kind: string;
  readonly message: string;
}

export type TranscriptStepDetail =
  | { readonly kind: 'dom-snapshot'; readonly snapshot: DomSnapshotView }
  | {
      readonly kind: 'query-selector';
      readonly selector: string;
      readonly matchCount: number | null;
      readonly previews: readonly SelectorPreviewView[];
      readonly previewsTruncated: boolean;
      readonly error: SelectorErrorView | null;
    }
  | {
      readonly kind: 'run-single-test';
      readonly candidate: string;
      readonly passed: boolean;
      readonly executed: boolean;
      readonly rejected: string | null;
      readonly violations: readonly IntegrityViolationView[];
      readonly changedLines: readonly SpecLineChangeView[];
      readonly output: string;
    }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'unknown'; readonly json: string };

export interface TranscriptStep {
  /** 1-based, in execution order. Falls back to array position + 1. */
  readonly index: number;
  readonly toolCallId: string | null;
  /** The verbatim tool name the model sent, or '(unknown tool)'. */
  readonly tool: string;
  readonly ok: boolean;
  readonly rawArguments: string;
  readonly resultSummary: string;
  readonly startedAt: string | null;
  readonly durationMs: number | null;
  readonly detail: TranscriptStepDetail;
}

export interface ModelTurnView {
  readonly turn: number | null;
  readonly finishReason: string | null;
  readonly contentPreview: string;
  readonly requestedTools: readonly string[];
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
}

export interface VerificationView {
  readonly candidateSelector: string;
  readonly passed: boolean;
  readonly executed: boolean;
  readonly rejected: string | null;
  readonly changedLines: readonly SpecLineChangeView[];
  readonly output: string;
  readonly durationMs: number | null;
}

export interface MeasurementView {
  readonly selector: string;
  readonly matchCount: number | null;
  readonly measured: boolean;
  readonly error: string | null;
  readonly measuredAt: string | null;
  readonly durationMs: number | null;
}

export interface ConfidenceSignalsView {
  readonly verified: boolean | null;
  readonly proposedSelector: string | null;
  readonly toolCallCount: number | null;
  readonly matchCount: number | null;
  readonly matchMeasured: boolean | null;
  readonly capReached: boolean | null;
  readonly outcome: string | null;
  readonly stopReason: string | null;
}

export interface TranscriptEnvelopeView {
  readonly kind: 'envelope';
  readonly schemaVersion: number | null;
  readonly truncated: boolean;
  readonly outcome: string | null;
  readonly stopReason: string | null;
  /** The gate's verdict at heal time. NOT authoritative: the row columns are. */
  readonly recordedConfidence: string | null;
  readonly recordedStatus: string | null;
  readonly prEligible: boolean | null;
  readonly reasons: readonly string[];
  readonly failureReason: string | null;
  readonly proposedSelector: string | null;
  readonly originalSelector: string | null;
  readonly toolCallCount: number | null;
  readonly capReached: boolean | null;
  readonly modelTurnCount: number | null;
  readonly model: string | null;
  readonly startedAt: string | null;
  readonly durationMs: number | null;
  readonly errorMessage: string | null;
  readonly verification: VerificationView | null;
  readonly measurement: MeasurementView | null;
  readonly signals: ConfidenceSignalsView | null;
  readonly bootstrapSnapshot: DomSnapshotView | null;
  readonly bootstrapSpecSource: string | null;
  /** messages.length. The messages themselves are deliberately not rendered (Q2). */
  readonly messageCount: number;
  readonly steps: readonly TranscriptStep[];
  readonly modelTurns: readonly ModelTurnView[];
}

export type TranscriptView =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unrecognised'; readonly json: string }
  | TranscriptEnvelopeView;

/**
 * Sub-normalisers: defensive, total, pure, never throw.
 */

export function normaliseDomSnapshot(value: unknown): DomSnapshotView | null {
  const obj = asObject(value);
  if (obj === null) {
    return null;
  }
  return {
    url: asString(obj.url),
    html: asString(obj.html) ?? '',
    estimatedTokens: asNumber(obj.estimatedTokens),
    elementCount: asNumber(obj.elementCount),
    truncated: asBoolean(obj.truncated) ?? false,
    capturedAt: asString(obj.capturedAt),
  };
}

export function normalisePreview(value: unknown): SelectorPreviewView {
  const obj = asObject(value);
  if (obj === null) {
    return {
      index: null,
      tagName: null,
      id: null,
      classList: [],
      role: null,
      text: '',
      visible: null,
    };
  }
  return {
    index: asNumber(obj.index),
    tagName: asString(obj.tagName),
    id: asString(obj.id),
    classList: asStringArray(obj.classList),
    role: asString(obj.role),
    text: asString(obj.text) ?? '',
    visible: asBoolean(obj.visible),
  };
}

export function normaliseChangedLines(value: unknown): readonly SpecLineChangeView[] {
  return asArray(value).map((v) => {
    const obj = asObject(v);
    if (obj === null) {
      return {
        lineNumber: null,
        before: '',
        after: '',
      };
    }
    return {
      lineNumber: asNumber(obj.lineNumber),
      before: asString(obj.before) ?? '',
      after: asString(obj.after) ?? '',
    };
  });
}

export function normaliseViolations(value: unknown): readonly IntegrityViolationView[] {
  return asArray(value).map((v) => {
    const obj = asObject(v);
    return {
      rule: asString(obj?.rule) ?? '',
      detail: asString(obj?.detail) ?? '',
    };
  });
}

export function normaliseVerification(value: unknown): VerificationView | null {
  const obj = asObject(value);
  if (obj === null) {
    return null;
  }
  return {
    candidateSelector: asString(obj.candidateSelector) ?? '',
    passed: asBoolean(obj.passed) ?? false,
    executed: asBoolean(obj.executed) ?? false,
    rejected: asString(obj.rejected),
    changedLines: normaliseChangedLines(obj.changedLines),
    output: asString(obj.output) ?? '',
    durationMs: asNumber(obj.durationMs),
  };
}

export function normaliseMeasurement(value: unknown): MeasurementView | null {
  const obj = asObject(value);
  if (obj === null) {
    return null;
  }
  return {
    selector: asString(obj.selector) ?? '',
    matchCount: asNumber(obj.matchCount),
    measured: asBoolean(obj.measured) ?? false,
    error: asString(obj.error),
    measuredAt: asString(obj.measuredAt),
    durationMs: asNumber(obj.durationMs),
  };
}

export function normaliseSignals(value: unknown): ConfidenceSignalsView | null {
  const obj = asObject(value);
  if (obj === null) {
    return null;
  }
  return {
    verified: asBoolean(obj.verified),
    proposedSelector: asString(obj.proposedSelector),
    toolCallCount: asNumber(obj.toolCallCount),
    matchCount: asNumber(obj.matchCount),
    matchMeasured: asBoolean(obj.matchMeasured),
    capReached: asBoolean(obj.capReached),
    outcome: asString(obj.outcome),
    stopReason: asString(obj.stopReason),
  };
}

export function normaliseModelTurn(value: unknown): ModelTurnView {
  const obj = asObject(value);
  if (obj === null) {
    return {
      turn: null,
      finishReason: null,
      contentPreview: '',
      requestedTools: [],
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    };
  }
  const usage = asObject(obj.usage);
  return {
    turn: asNumber(obj.turn),
    finishReason: asString(obj.finishReason),
    contentPreview: asString(obj.contentPreview) ?? '',
    requestedTools: asStringArray(obj.requestedTools),
    promptTokens: usage ? asNumber(usage.promptTokens) : null,
    completionTokens: usage ? asNumber(usage.completionTokens) : null,
    totalTokens: usage ? asNumber(usage.totalTokens) : null,
  };
}

export function normaliseStepDetail(value: unknown): TranscriptStepDetail {
  const obj = asObject(value);
  const kind = asString(obj?.kind);

  if (kind === 'dom-snapshot') {
    const snapshot = normaliseDomSnapshot(value);
    return {
      kind: 'dom-snapshot',
      snapshot: snapshot ?? {
        url: null,
        html: '',
        estimatedTokens: null,
        elementCount: null,
        truncated: false,
        capturedAt: null,
      },
    };
  }

  if (kind === 'query-selector') {
    const errorObj = asObject(obj?.error);
    return {
      kind: 'query-selector',
      selector: asString(obj?.selector) ?? '',
      matchCount: asNumber(obj?.matchCount),
      previews: asArray(obj?.previews).map(normalisePreview),
      previewsTruncated: asBoolean(obj?.previewsTruncated) ?? false,
      error: errorObj
        ? {
            kind: asString(errorObj.kind) ?? 'error',
            message: asString(errorObj.message) ?? '',
          }
        : null,
    };
  }

  if (kind === 'run-single-test') {
    return {
      kind: 'run-single-test',
      candidate: asString(obj?.candidate) ?? '',
      passed: asBoolean(obj?.passed) ?? false,
      executed: asBoolean(obj?.executed) ?? false,
      rejected: asString(obj?.rejected),
      violations: normaliseViolations(obj?.violations),
      changedLines: normaliseChangedLines(obj?.changedLines),
      output: asString(obj?.output) ?? '',
    };
  }

  if (kind === 'error') {
    return {
      kind: 'error',
      message: asString(obj?.message) ?? '',
    };
  }

  return {
    kind: 'unknown',
    json: formatJson(value),
  };
}

export function normaliseStep(value: unknown, position: number): TranscriptStep {
  const obj = asObject(value);
  if (obj === null) {
    return {
      index: position + 1,
      toolCallId: null,
      tool: '(unknown tool)',
      ok: false,
      rawArguments: '',
      resultSummary: '',
      startedAt: null,
      durationMs: null,
      detail: { kind: 'unknown', json: formatJson(value) },
    };
  }
  return {
    index: asNumber(obj.index) ?? position + 1,
    toolCallId: asString(obj.toolCallId),
    tool: asString(obj.tool) ?? '(unknown tool)',
    ok: asBoolean(obj.ok) ?? false,
    rawArguments: asString(obj.rawArguments) ?? '',
    resultSummary: asString(obj.resultSummary) ?? '',
    startedAt: asString(obj.startedAt),
    durationMs: asNumber(obj.durationMs),
    detail: normaliseStepDetail(obj.result),
  };
}

/**
 * Main normaliser: total, pure, lossless. Never throws. Clamping is the components' job.
 */

export function normaliseTranscript(raw: unknown): TranscriptView {
  // Step 1: Parse if string
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return normaliseTranscript(parsed);
    } catch {
      return { kind: 'unrecognised', json: raw };
    }
  }

  // Step 2: Check outer object
  const obj = asObject(raw);
  if (obj === null || Object.keys(obj).length === 0) {
    return { kind: 'absent' };
  }

  // Step 3: Check inner transcript
  const inner = asObject(obj.transcript);
  if (inner === null) {
    return { kind: 'unrecognised', json: formatJson(raw) };
  }

  // Step 4: Normalise envelope
  return {
    kind: 'envelope',
    schemaVersion: asNumber(obj.schemaVersion),
    truncated: asBoolean(obj.truncated) ?? false,
    outcome: asString(obj.outcome),
    stopReason: asString(obj.stopReason),
    recordedConfidence: asString(obj.confidence),
    recordedStatus: asString(obj.status),
    prEligible: asBoolean(obj.prEligible),
    reasons: asStringArray(obj.reasons),
    failureReason: asString(obj.failureReason),
    proposedSelector: asString(obj.proposedSelector),
    originalSelector: asString(obj.originalSelector),
    toolCallCount: asNumber(obj.toolCallCount),
    capReached: asBoolean(obj.capReached),
    modelTurnCount: asNumber(obj.modelTurnCount),
    model: asString(obj.model),
    startedAt: asString(obj.startedAt),
    durationMs: asNumber(obj.durationMs),
    errorMessage: asString(obj.errorMessage),
    verification: normaliseVerification(obj.verification),
    measurement: normaliseMeasurement(obj.measurement),
    signals: normaliseSignals(obj.signals),
    bootstrapSnapshot: normaliseDomSnapshot(inner.bootstrapSnapshot),
    bootstrapSpecSource: asString(inner.bootstrapSpecSource),
    messageCount: asArray(inner.messages).length,
    steps: asArray(inner.toolCalls).map(normaliseStep),
    modelTurns: asArray(inner.modelRequests).map(normaliseModelTurn),
  };
}

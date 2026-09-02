import type { ClassifiedFailure } from '../classifier/failure-classifier.js';
import type {
  BootstrapSnapshot,
  ChatMessage,
  HealDeps,
  HealResult,
  HealStopReason,
  HealToolbox,
  HealToolName,
  ModelResponse,
  ModelToolCall,
  ToolCallRecord,
  ToolCallResult,
  VerificationSummary,
  VerifiedFix,
} from './types.js';
import { HEAL_TOOL_SCHEMAS, isHealToolName, parseToolArguments, summariseToolResult } from './tool-schemas.js';
import { buildInitialMessages, clampSpecSource, MAX_SPEC_SOURCE_CHARS } from './prompt.js';

export const MAX_TOOL_CALLS = 5;
export const MAX_MODEL_TURNS = 6;

export async function healFailure(
  failure: ClassifiedFailure,
  deps: HealDeps,
): Promise<HealResult> {
  // Validate input
  if (
    failure.classification !== 'selector-drift' ||
    failure.selector === null ||
    failure.selector.trim() === '' ||
    failure.specFile.trim() === '' ||
    failure.testName.trim() === ''
  ) {
    const offendingField =
      failure.classification !== 'selector-drift'
        ? 'classification'
        : failure.selector === null || failure.selector.trim() === ''
          ? 'selector'
          : failure.specFile.trim() === ''
            ? 'specFile'
            : 'testName';

    return {
      specFile: failure.specFile,
      testName: failure.testName,
      originalSelector: failure.selector ?? '',
      proposedSelector: null,
      outcome: 'error',
      stopReason: 'invalid-input',
      verified: false,
      toolCallCount: 0,
      capReached: false,
      modelTurnCount: 0,
      verification: null,
      transcript: {
        bootstrapSnapshot: null,
        bootstrapSpecSource: null,
        messages: [],
        toolCalls: [],
        modelRequests: [],
      },
      model: deps.model.model,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      errorMessage: `invalid input: ${offendingField}`,
    };
  }

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const cap = Math.min(deps.maxToolCalls ?? MAX_TOOL_CALLS, MAX_TOOL_CALLS);

  const bootstrapSpecSource =
    deps.specSource === undefined || deps.specSource === null
      ? null
      : clampSpecSource(deps.specSource);

  const messages: ChatMessage[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const modelRequests = [];

  let toolCallCount = 0;
  let modelTurnCount = 0;
  let capReached = false;
  let verifiedFix: VerifiedFix | null = null;
  let verification: VerificationSummary | null = null;
  let stopReason: HealStopReason = 'model-turn-limit-reached';
  let errorMessage: string | null = null;
  let bootstrapSnapshot: BootstrapSnapshot | null = null;

  // Bootstrap snapshot (one model-free capture before first request, not counted against cap)
  let domSnapshot;
  try {
    domSnapshot = await deps.toolbox.getDomSnapshot();
    bootstrapSnapshot = {
      url: domSnapshot.url,
      html: domSnapshot.html,
      estimatedTokens: domSnapshot.estimatedTokens,
      elementCount: domSnapshot.elementCount,
      truncated: domSnapshot.truncated,
      capturedAt: domSnapshot.capturedAt,
    };
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    stopReason = 'toolbox-error';

    const result: HealResult = {
      specFile: failure.specFile,
      testName: failure.testName,
      originalSelector: failure.selector ?? '',
      proposedSelector: null,
      outcome: 'error',
      stopReason,
      verified: false,
      toolCallCount: 0,
      capReached: false,
      modelTurnCount: 0,
      verification: null,
      transcript: {
        bootstrapSnapshot: null,
        bootstrapSpecSource,
        messages: [],
        toolCalls: [],
        modelRequests: [],
      },
      model: deps.model.model,
      startedAt,
      durationMs: Date.now() - t0,
      errorMessage,
    };

    assertHealInvariant(result);
    return result;
  }

  // Build initial messages using the buildInitialMessages function
  messages.push(...buildInitialMessages(failure, deps.appUrl, domSnapshot, bootstrapSpecSource));

  // Main loop
  turnLoop: for (let turn = 1; turn <= MAX_MODEL_TURNS; turn++) {
    modelTurnCount = turn;

    let response: ModelResponse;
    try {
      response = await deps.model.createCompletion({ messages, tools: HEAL_TOOL_SCHEMAS });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      stopReason = 'model-error';
      break turnLoop;
    }

    modelRequests.push({
      turn,
      finishReason: response.finishReason,
      usage: response.usage,
      contentPreview: (response.content ?? '').slice(0, 500),
      requestedTools: response.toolCalls.map((c) => c.name),
    });

    // Add assistant message to conversation
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: response.content,
      ...(response.toolCalls.length > 0
        ? {
            tool_calls: response.toolCalls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: c.argumentsJson },
            })),
          }
        : {}),
    };
    messages.push(assistantMessage);

    // Check if model gave up
    if (response.toolCalls.length === 0) {
      stopReason = 'model-gave-up';
      break turnLoop;
    }

    // Execute tool calls
    for (const call of response.toolCalls) {
      // Check cap before execution
      if (toolCallCount >= cap) {
        capReached = true;
        stopReason = 'tool-call-cap-reached';
        break turnLoop;
      }

      toolCallCount += 1;
      const record = await executeToolCall(deps.toolbox, call, toolCallCount);
      toolCalls.push(record);

      // Add tool result message
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: record.resultSummary,
      });

      // Check if this was a passing run_single_test
      if (record.result.kind === 'run-single-test') {
        verification = {
          candidateSelector: record.result.candidate,
          passed: record.result.passed,
          executed: record.result.executed,
          rejected: record.result.rejected,
          changedLines: record.result.changedLines,
          output: record.result.output,
          durationMs: record.durationMs,
        };

        // THE VERIFICATION GATE
        if (record.result.passed === true) {
          verifiedFix = {
            candidateSelector: record.result.candidate,
            toolCallIndex: toolCallCount,
          };
          stopReason = 'verified-fix';
          break turnLoop;
        }
      }
    }

    // Check cap after inner loop
    if (toolCallCount >= cap) {
      capReached = true;
      stopReason = 'tool-call-cap-reached';
      break turnLoop;
    }
  }

  // Build result
  const outcome = verifiedFix !== null ? 'healed' : errorMessage !== null ? 'error' : 'no-fix';

  const result: HealResult = {
    specFile: failure.specFile,
    testName: failure.testName,
    originalSelector: failure.selector ?? '',
    proposedSelector: verifiedFix?.candidateSelector ?? null,
    outcome,
    stopReason,
    verified: verifiedFix !== null,
    toolCallCount,
    capReached,
    modelTurnCount,
    verification,
    transcript: {
      bootstrapSnapshot,
      bootstrapSpecSource,
      messages,
      toolCalls,
      modelRequests,
    },
    model: deps.model.model,
    startedAt,
    durationMs: Date.now() - t0,
    errorMessage,
  };

  assertHealInvariant(result);
  return result;
}

export function assertHealInvariant(result: HealResult): void {
  // Check 1: proposedSelector non-null iff outcome is healed
  if ((result.proposedSelector !== null) !== (result.outcome === 'healed')) {
    throw new Error('heal invariant violated: proposedSelector !== null iff outcome === healed');
  }

  // Check 2: proposedSelector non-null iff verified
  if ((result.proposedSelector !== null) !== result.verified) {
    throw new Error('heal invariant violated: proposedSelector !== null iff verified');
  }

  // Check 3: proposedSelector is null OR verification.passed is true
  if (result.proposedSelector !== null && result.verification?.passed !== true) {
    throw new Error('heal invariant violated: proposedSelector !== null implies verification?.passed === true');
  }

  // Check 4: proposedSelector is null OR verification.candidate equals proposedSelector
  if (
    result.proposedSelector !== null &&
    result.verification?.candidateSelector !== result.proposedSelector
  ) {
    throw new Error('heal invariant violated: verification.candidateSelector !== proposedSelector');
  }

  // Check 5: toolCallCount <= MAX_TOOL_CALLS
  if (result.toolCallCount > MAX_TOOL_CALLS) {
    throw new Error('heal invariant violated: toolCallCount > MAX_TOOL_CALLS');
  }

  // Check 6: transcript.toolCalls.length === toolCallCount
  if (result.transcript.toolCalls.length !== result.toolCallCount) {
    throw new Error('heal invariant violated: transcript.toolCalls.length !== toolCallCount');
  }

  // Check 7: the spec source shown to the model is bounded
  if (
    result.transcript.bootstrapSpecSource !== null &&
    result.transcript.bootstrapSpecSource.length > MAX_SPEC_SOURCE_CHARS + 20
  ) {
    throw new Error('heal invariant violated: bootstrapSpecSource exceeds MAX_SPEC_SOURCE_CHARS');
  }
}

// Private function to execute a single tool call
async function executeToolCall(
  toolbox: HealToolbox,
  call: ModelToolCall,
  index: number,
): Promise<ToolCallRecord> {
  const startedAt = new Date().toISOString();
  const t = Date.now();

  // Check if tool name is valid
  if (!isHealToolName(call.name)) {
    return {
      index,
      toolCallId: call.id,
      tool: call.name,
      rawArguments: call.argumentsJson,
      arguments: {},
      ok: false,
      result: {
        kind: 'error',
        message: `unknown tool: ${call.name}`,
      },
      resultSummary: JSON.stringify({ error: `unknown tool: ${call.name}` }),
      startedAt,
      durationMs: Date.now() - t,
    };
  }

  // Parse arguments
  const parsed = parseToolArguments(call.name as HealToolName, call.argumentsJson);
  if (!parsed.ok) {
    return {
      index,
      toolCallId: call.id,
      tool: call.name,
      rawArguments: call.argumentsJson,
      arguments: parsed.args,
      ok: false,
      result: {
        kind: 'error',
        message: parsed.error!,
      },
      resultSummary: JSON.stringify({ error: parsed.error }),
      startedAt,
      durationMs: Date.now() - t,
    };
  }

  // Execute the tool
  let result: ToolCallResult;
  try {
    if (call.name === 'get_dom_snapshot') {
      const s = await toolbox.getDomSnapshot();
      result = {
        kind: 'dom-snapshot',
        url: s.url,
        html: s.html,
        estimatedTokens: s.estimatedTokens,
        elementCount: s.elementCount,
        truncated: s.truncated,
      };
    } else if (call.name === 'query_selector') {
      const r = await toolbox.querySelector(parsed.value!);
      result = {
        kind: 'query-selector',
        selector: r.selector,
        matchCount: r.matchCount,
        previews: r.previews,
        previewsTruncated: r.previewsTruncated,
        error: r.error,
      };
    } else {
      // run_single_test
      const r = await toolbox.runSingleTest(parsed.value!);
      result = {
        kind: 'run-single-test',
        candidate: parsed.value!,
        passed: r.passed,
        executed: r.executed,
        rejected: r.rejected,
        violations: r.violations,
        changedLines: r.changedLines,
        output: r.output,
      };
    }
  } catch (error) {
    result = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    index,
    toolCallId: call.id,
    tool: call.name,
    rawArguments: call.argumentsJson,
    arguments: parsed.args,
    ok: result.kind !== 'error',
    result,
    resultSummary: summariseToolResult(result),
    startedAt,
    durationMs: Date.now() - t,
  };
}

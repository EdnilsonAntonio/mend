import type {
  HealToolbox,
  ModelClient,
  ModelResponse,
  ModelToolCall,
} from '../types.js';
import type { RunSingleTestResult } from '../../tools/run-single-test.js';
import type { DomSnapshot } from '../../tools/get-dom-snapshot.js';
import type { QuerySelectorResult, SelectorMatchPreview } from '../../tools/query-selector.js';

export interface ScriptedTurn {
  readonly content?: string | null;
  readonly toolCalls?: readonly { name: string; args: unknown | string }[];
}

export function scriptedModel(
  turns: readonly ScriptedTurn[],
  options?: { readonly model?: string; readonly repeatLast?: boolean; readonly throwOnTurn?: number },
): ModelClient & { readonly turnCount: () => number } {
  const model = options?.model ?? 'scripted-model';
  let turnIndex = 0;
  let turnCount_ = 0;

  return {
    model,
    createCompletion: async (): Promise<ModelResponse> => {
      turnCount_++;

      if (options?.throwOnTurn === turnCount_) {
        throw new Error('scripted model failure');
      }

      let turn: ScriptedTurn;
      if (turnIndex < turns.length) {
        turn = turns[turnIndex]!;
        turnIndex++;
      } else if (options?.repeatLast) {
        turn = turns[turns.length - 1]!;
      } else {
        turn = {};
      }

      const toolCalls: ModelToolCall[] = (turn.toolCalls ?? []).map((tc, i) => {
        const argsStr = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args);
        return {
          id: `call_${i + 1}`,
          name: tc.name,
          argumentsJson: argsStr,
        };
      });

      return {
        content: turn.content ?? null,
        toolCalls,
        finishReason: 'stop',
        usage: null,
      };
    },
    turnCount: () => turnCount_,
  };
}

export function fakeToolbox(options: {
  readonly snapshotHtml?: string;
  readonly matchCounts?: Readonly<Record<string, number>>;
  readonly passingCandidates?: readonly string[];
  readonly failWith?: Readonly<Record<string, Partial<RunSingleTestResult>>>;
  readonly throwOn?: readonly string[];
  readonly passOnNthRun?: number;
}): HealToolbox & {
  readonly calls: () => readonly { tool: string; arg: string }[];
} {
  const callsLog: { tool: string; arg: string }[] = [];
  let runCount = 0;
  let bootstrapCalled = false;

  return {
    getDomSnapshot: async (): Promise<DomSnapshot> => {
      // Only log the first (bootstrap) call separately; subsequent calls are model-initiated
      if (!bootstrapCalled) {
        bootstrapCalled = true;
        // Don't log bootstrap in callsLog
      } else {
        callsLog.push({ tool: 'get_dom_snapshot', arg: '' });
      }
      if (options.throwOn?.includes('get_dom_snapshot')) {
        throw new Error('get_dom_snapshot threw');
      }
      return {
        url: 'http://localhost:3100/',
        html: options.snapshotHtml ?? '<html><body></body></html>',
        estimatedTokens: 100,
        elementCount: 1,
        depthLimit: null,
        truncated: false,
        capturedAt: new Date().toISOString(),
      };
    },
    querySelector: async (selector: string): Promise<QuerySelectorResult> => {
      callsLog.push({ tool: 'query_selector', arg: selector });
      if (options.throwOn?.includes('query_selector')) {
        throw new Error('query_selector threw');
      }
      const matchCount = options.matchCounts?.[selector] ?? 0;
      const previews: readonly SelectorMatchPreview[] = matchCount > 0 ? [
        {
          index: 0,
          tagName: 'button',
          id: null,
          classList: [],
          role: null,
          text: 'Sign In',
          visible: true,
        },
      ] : [];
      return {
        selector,
        matchCount,
        previews,
        previewsTruncated: false,
        error: null,
      };
    },
    runSingleTest: async (candidateSelector: string): Promise<RunSingleTestResult> => {
      callsLog.push({ tool: 'run_single_test', arg: candidateSelector });
      if (options.throwOn?.includes('run_single_test')) {
        throw new Error('run_single_test threw');
      }

      runCount++;
      const passed =
        options.passingCandidates?.includes(candidateSelector) ||
        (options.passOnNthRun !== undefined && runCount === options.passOnNthRun);

      const failWith = options.failWith?.[candidateSelector];

      return {
        passed,
        output: failWith?.output ?? (passed ? '' : '  1 failed'),
        executed: failWith?.executed ?? true,
        exitCode: failWith?.exitCode ?? (passed ? 0 : 1),
        timedOut: failWith?.timedOut ?? false,
        rejected: failWith?.rejected ?? null,
        violations: failWith?.violations ?? [],
        specFile: 'tests/test.spec.ts',
        testName: 'test',
        originalSelector: '#login-btn',
        candidateSelector,
        proposedSource: failWith?.proposedSource ?? 'proposed',
        changedLines: failWith?.changedLines ?? [],
        durationMs: failWith?.durationMs ?? 100,
      };
    },
    calls: () => callsLog,
  };
}

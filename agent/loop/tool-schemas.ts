import type { ToolCallResult, ToolArgumentsParseResult, ToolSchema, HealToolName } from './types.js';

export const HEAL_TOOL_NAMES = ['get_dom_snapshot', 'query_selector', 'run_single_test'] as const;
export const MAX_TOOL_RESULT_CHARS = 4_000;
export const MAX_TEST_OUTPUT_TAIL_CHARS = 1_500;

export const HEAL_TOOL_SCHEMAS: readonly ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'get_dom_snapshot',
      description:
        'Return a pruned HTML snapshot of the page under test as it is right now. Takes no arguments.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_selector',
      description:
        'Report how many elements a candidate selector matches on the page, with a short preview of each. This inspects only; it never verifies a fix and never changes the page.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'A CSS or Playwright selector to evaluate.' },
        },
        required: ['selector'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_single_test',
      description:
        'Substitute the candidate selector for the original selector in a temporary copy of the spec file and actually execute that one test. This is the only way a fix is ever accepted. The original spec file is never modified, and any change that removes, weakens, or skips an assertion is rejected before execution.',
      parameters: {
        type: 'object',
        properties: {
          candidate: {
            type: 'string',
            description: 'The replacement selector to verify by real execution.',
          },
        },
        required: ['candidate'],
        additionalProperties: false,
      },
    },
  },
];

export function isHealToolName(name: string): name is HealToolName {
  return HEAL_TOOL_NAMES.includes(name as HealToolName);
}

export function parseToolArguments(
  tool: HealToolName,
  argumentsJson: string,
): ToolArgumentsParseResult {
  // For get_dom_snapshot, always succeed regardless of arguments
  if (tool === 'get_dom_snapshot') {
    const parsed = tryParseJson(argumentsJson);
    return {
      ok: true,
      args: parsed ?? {} as Record<string, unknown>,
      value: null,
      error: null,
    };
  }

  // For other tools, parse JSON and extract the required field
  const parsed = tryParseJson(argumentsJson);
  if (parsed === null) {
    return {
      ok: false,
      args: {} as Record<string, unknown>,
      value: null,
      error: 'arguments are not valid JSON',
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      args: {} as Record<string, unknown>,
      value: null,
      error: 'arguments must be a JSON object',
    };
  }

  const fieldName = tool === 'query_selector' ? 'selector' : 'candidate';
  const fieldValue = (parsed as Record<string, unknown>)[fieldName];

  if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
    return {
      ok: false,
      args: parsed as Record<string, unknown>,
      value: null,
      error: `missing or empty "${fieldName}"`,
    };
  }

  return {
    ok: true,
    args: parsed as Record<string, unknown>,
    value: fieldValue,
    error: null,
  };
}

export function summariseToolResult(record: ToolCallResult): string {
  switch (record.kind) {
    case 'dom-snapshot':
      return JSON.stringify({
        url: record.url,
        estimatedTokens: record.estimatedTokens,
        elementCount: record.elementCount,
        truncated: record.truncated,
        html: clampHead(record.html, MAX_TOOL_RESULT_CHARS),
      });
    case 'query-selector':
      return JSON.stringify({
        selector: record.selector,
        matchCount: record.matchCount,
        previews: record.previews,
        previewsTruncated: record.previewsTruncated,
        error: record.error,
      });
    case 'run-single-test':
      return JSON.stringify({
        candidate: record.candidate,
        passed: record.passed,
        executed: record.executed,
        rejected: record.rejected,
        violations: record.violations,
        changedLineCount: record.changedLines.length,
        outputTail: clampTail(record.output, MAX_TEST_OUTPUT_TAIL_CHARS),
      });
    case 'error':
      return JSON.stringify({ error: record.message });
  }
}

// Private helpers
function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed;
  } catch {
    return null;
  }
}

function clampHead(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + '\n…[truncated]…';
}

function clampTail(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return '…[truncated]…\n' + text.slice(-max);
}

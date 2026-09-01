import type { ModelClient, ModelRequest, ModelResponse, ModelUsage } from './types.js';

export const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_HEAL_MODEL = 'gpt-4o-mini';
export const MODEL_REQUEST_TIMEOUT_MS = 60_000;

export function resolveHealModel(): string {
  const envModel = process.env['MEND_OPENAI_MODEL'];
  return envModel && envModel.trim() ? envModel : DEFAULT_HEAL_MODEL;
}

export function createOpenAIClient(overrides?: {
  readonly model?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}): ModelClient {
  const apiKey = overrides?.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';

  if (apiKey.trim() === '') {
    throw new Error('OPENAI_API_KEY is not set; export it before running a heal');
  }

  const model = overrides?.model ?? resolveHealModel();
  const timeoutMs = overrides?.timeoutMs ?? MODEL_REQUEST_TIMEOUT_MS;

  return {
    model,
    createCompletion: async (request: ModelRequest): Promise<ModelResponse> => {
      const body = JSON.stringify({
        model,
        messages: request.messages,
        tools: request.tools,
        tool_choice: 'auto',
        temperature: 0,
        parallel_tool_calls: false,
      });

      const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const responseBody = await response.text();
        const clampedBody = responseBody.length > 1000 ? responseBody.slice(0, 1000) : responseBody;
        throw new Error(`OpenAI request failed: ${response.status} ${clampedBody}`);
      }

      const data = (await response.json()) as unknown;
      const body_ = data as Record<string, unknown>;

      const choices = body_.choices as unknown[];
      if (!choices || !Array.isArray(choices) || !choices[0]) {
        throw new Error('OpenAI response contained no choices');
      }

      const choice0 = choices[0] as Record<string, unknown>;
      const message = choice0.message as Record<string, unknown> | undefined;

      if (!message) {
        throw new Error('OpenAI response contained no choices');
      }

      const toolCallsRaw = (message.tool_calls ?? []) as unknown[];
      const toolCalls = toolCallsRaw
        .map((tc) => {
          const tcObj = tc as Record<string, unknown>;
          const tcId = (typeof tcObj.id === 'string' ? tcObj.id : '') ?? '';
          const funcObj = tcObj.function as Record<string, unknown> | undefined;
          const tcName = (typeof funcObj?.name === 'string' ? funcObj.name : '') ?? '';
          const tcArgs = (typeof funcObj?.arguments === 'string' ? funcObj.arguments : '') ?? '';
          return {
            id: tcId,
            name: tcName,
            argumentsJson: tcArgs,
          };
        })
        .filter((tc) => tc.name.length > 0); // Guard against empty names

      const usage = extractUsage(body_);

      return {
        content: (message.content as string | null) ?? null,
        toolCalls,
        finishReason: (choice0.finish_reason as string) ?? 'unknown',
        usage,
      };
    },
  };
}

function extractUsage(body: Record<string, unknown>): ModelUsage | null {
  const usageObj = body.usage as Record<string, unknown> | undefined;
  if (!usageObj) {
    return null;
  }

  const promptTokens = usageObj.prompt_tokens as number | undefined;
  const completionTokens = usageObj.completion_tokens as number | undefined;
  const totalTokens = usageObj.total_tokens as number | undefined;

  if (promptTokens === undefined || completionTokens === undefined || totalTokens === undefined) {
    return null;
  }

  return { promptTokens, completionTokens, totalTokens };
}

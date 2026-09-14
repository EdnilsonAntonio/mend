export interface ModelPrice {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  /** Human-readable provenance. Printed in the report footer. */
  readonly source: string;
}

export const MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  'gpt-4o-mini': {
    inputUsdPerMillionTokens: 0.15,
    outputUsdPerMillionTokens: 0.6,
    source: 'OpenAI public API pricing, recorded 2026-09-14',
  },
};

/** Lowercases, trims, and strips a trailing `-YYYY-MM-DD` dated-snapshot suffix. */
export function normaliseModelId(model: string): string {
  return model.trim().toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

/** Exact lookup on the normalised id. null when unknown or when `model` is null/empty. */
export function lookupModelPrice(model: string | null): ModelPrice | null {
  if (model === null || model.trim() === '') {
    return null;
  }
  return MODEL_PRICING[normaliseModelId(model)] ?? null;
}

/** (prompt/1e6)*input + (completion/1e6)*output. Unrounded. Negative inputs clamp to 0. */
export function costUsd(price: ModelPrice, promptTokens: number, completionTokens: number): number {
  const p = Math.max(0, promptTokens);
  const c = Math.max(0, completionTokens);
  return (p / 1_000_000) * price.inputUsdPerMillionTokens +
         (c / 1_000_000) * price.outputUsdPerMillionTokens;
}

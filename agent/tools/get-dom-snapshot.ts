import type { Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { pruneDocument, type PruneRequest } from './dom-prune.js';

export interface DomSnapshotOptions {
  /** Tag names (lowercase) removed with their entire subtree. */
  readonly removeTags: readonly string[];
  /** Attribute names (lowercase) kept. Any `aria-*` attribute is also kept. */
  readonly keepAttributes: readonly string[];
  /** Text nodes longer than this are truncated and suffixed with U+2026. */
  readonly maxTextLength: number;
  /** Attribute values longer than this are truncated and suffixed with U+2026. */
  readonly maxAttributeLength: number;
  /** Estimated-token budget for the serialized snapshot. */
  readonly tokenCeiling: number;
  /** Ordered max-depth rungs tried until the budget is met. Fixed length; no unbounded retry. */
  readonly depthLadder: readonly number[];
}

export interface DomSnapshot {
  /** The page URL the snapshot was taken from. */
  readonly url: string;
  /** Pruned, well-formed HTML. Never truncated mid-string. */
  readonly html: string;
  /** ceil(html.length / 4). A heuristic, not a real tokenizer. */
  readonly estimatedTokens: number;
  /** Number of elements actually emitted into `html`. */
  readonly elementCount: number;
  /** null when the full tree was serialized; otherwise the depth rung that was used. */
  readonly depthLimit: number | null;
  /** True when a depth limit had to be applied to meet the token ceiling. */
  readonly truncated: boolean;
  /** ISO 8601 timestamp. */
  readonly capturedAt: string;
}

export const DOM_SNAPSHOT_TOKEN_CEILING = 4000;

export const DOM_SNAPSHOT_DEPTH_LADDER: readonly number[] = [
  1000, 24, 16, 12, 10, 8, 6, 4, 2,
];

export const DEFAULT_DOM_SNAPSHOT_OPTIONS: DomSnapshotOptions = {
  removeTags: [
    'script',
    'style',
    'noscript',
    'template',
    'svg',
    'canvas',
    'iframe',
    'link',
    'meta',
    'base',
    'object',
    'embed',
    'audio',
    'video',
  ],
  keepAttributes: [
    'id',
    'class',
    'role',
    'type',
    'name',
    'href',
    'src',
    'alt',
    'title',
    'placeholder',
    'value',
    'for',
    'disabled',
    'checked',
    'selected',
    'readonly',
    'required',
    'hidden',
    'tabindex',
    'lang',
    'action',
    'method',
    'rel',
    'target',
  ],
  maxTextLength: 200,
  maxAttributeLength: 120,
  tokenCeiling: DOM_SNAPSHOT_TOKEN_CEILING,
  depthLadder: DOM_SNAPSHOT_DEPTH_LADDER,
};

/**
 * Estimate token count using the heuristic: ceil(text.length / 4).
 * This is a rough approximation, not a real tokenizer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Capture a DOM snapshot from a live Playwright Page.
 * Tries depth ladder rungs in order until one fits within the token ceiling.
 * Returns the best-fitting snapshot found; never truncates mid-string.
 */
export async function getDomSnapshot(
  page: Page,
  overrides?: Partial<DomSnapshotOptions>,
): Promise<DomSnapshot> {
  const options = { ...DEFAULT_DOM_SNAPSHOT_OPTIONS, ...overrides };

  if (options.depthLadder.length === 0) {
    throw new Error('depthLadder must contain at least one entry');
  }

  let lastResult: { html: string; elementCount: number } | null = null;
  let lastRung = -1;

  // Iterate depth ladder in order.
  for (let index = 0; index < options.depthLadder.length; index++) {
    const rung = options.depthLadder[index];
    if (rung === undefined) {
      throw new Error('Depth ladder entry is undefined');
    }
    lastRung = rung;

    // Build request with this depth rung.
    const req: PruneRequest = {
      removeTags: options.removeTags,
      keepAttributes: options.keepAttributes,
      maxTextLength: options.maxTextLength,
      maxAttributeLength: options.maxAttributeLength,
      maxDepth: rung,
    };

    // Evaluate the prune function in the browser.
    const result = await page.evaluate(pruneDocument, req);

    // Check if it fits.
    const estimatedTokens = estimateTokens(result.html);
    if (estimatedTokens <= options.tokenCeiling) {
      // This rung fits!
      const url = page.url();
      const capturedAt = new Date().toISOString();
      return {
        url,
        html: result.html,
        estimatedTokens,
        elementCount: result.elementCount,
        depthLimit: index === 0 ? null : rung,
        truncated: index !== 0,
        capturedAt,
      };
    }

    // Remember this result for fallback.
    lastResult = result;
  }

  // No rung fit; return the last result with truncated: true.
  if (lastResult === null) {
    throw new Error('Failed to generate any snapshot');
  }

  const url = page.url();
  const capturedAt = new Date().toISOString();
  const estimatedTokens = estimateTokens(lastResult.html);

  return {
    url,
    html: lastResult.html,
    estimatedTokens,
    elementCount: lastResult.elementCount,
    depthLimit: lastRung,
    truncated: true,
    capturedAt,
  };
}

/**
 * Capture a DOM snapshot from a URL by launching a browser, navigating, and capturing.
 * Closes the browser in a finally block.
 */
export async function captureDomSnapshotFromUrl(
  url: string,
  overrides?: Partial<DomSnapshotOptions>,
): Promise<DomSnapshot> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    return await getDomSnapshot(page, overrides);
  } finally {
    await browser.close();
  }
}

import type { Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import {
  describeElements,
  type SelectorPreviewRequest,
  type SelectorMatchPreview,
} from './selector-preview.js';

export type { SelectorMatchPreview };

export type SelectorErrorKind = 'invalid-selector' | 'evaluation-failed';

export interface SelectorError {
  /** `invalid-selector` = the selector string could not be parsed or resolved.
   *  `evaluation-failed` = the selector was valid but the browser call failed. */
  readonly kind: SelectorErrorKind;
  /** The underlying error message, verbatim. Never empty. */
  readonly message: string;
}

export interface QuerySelectorOptions {
  /** Maximum number of matched elements described in `previews`. */
  readonly maxPreviews: number;
  /** Preview text longer than this is truncated and suffixed with U+2026. */
  readonly maxPreviewTextLength: number;
}

export interface QuerySelectorResult {
  /** The caller's selector, verbatim and untrimmed. */
  readonly selector: string;
  /** True number of matched elements. 0 when `error` is `invalid-selector`. */
  readonly matchCount: number;
  /** At most `maxPreviews` entries. Empty when `error` is non-null. */
  readonly previews: readonly SelectorMatchPreview[];
  /** True when `matchCount > previews.length`. */
  readonly previewsTruncated: boolean;
  /** null on success, including for a zero-match selector. */
  readonly error: SelectorError | null;
}

export const QUERY_SELECTOR_MAX_PREVIEWS = 10;
export const QUERY_SELECTOR_MAX_PREVIEW_TEXT_LENGTH = 80;

export const DEFAULT_QUERY_SELECTOR_OPTIONS: QuerySelectorOptions = {
  maxPreviews: QUERY_SELECTOR_MAX_PREVIEWS,
  maxPreviewTextLength: QUERY_SELECTOR_MAX_PREVIEW_TEXT_LENGTH,
};

export const EMPTY_SELECTOR_MESSAGE = 'selector must be a non-empty string';

/**
 * Query a selector against a live Playwright Page.
 * Returns match count, previews, and any errors.
 * Never throws for an invalid selector; always resolves with a structured result.
 */
export async function querySelector(
  page: Page,
  selector: string,
  overrides?: Partial<QuerySelectorOptions>,
): Promise<QuerySelectorResult> {
  const options = { ...DEFAULT_QUERY_SELECTOR_OPTIONS, ...overrides };

  // Empty guard: trim the selector and check if it is empty.
  if (selector.trim().length === 0) {
    return {
      selector,
      matchCount: 0,
      previews: [],
      previewsTruncated: false,
      error: { kind: 'invalid-selector', message: EMPTY_SELECTOR_MESSAGE },
    };
  }

  // Phase 1: validate and count.
  let phase1Count = 0;
  try {
    const locator = page.locator(selector);
    phase1Count = await locator.count();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      selector,
      matchCount: 0,
      previews: [],
      previewsTruncated: false,
      error: { kind: 'invalid-selector', message },
    };
  }

  // Phase 2: describe.
  try {
    const locator = page.locator(selector);
    const req: SelectorPreviewRequest = {
      maxPreviews: options.maxPreviews,
      maxPreviewTextLength: options.maxPreviewTextLength,
    };
    const raw = await locator.evaluateAll(describeElements, req);

    return {
      selector,
      matchCount: raw.matchCount,
      previews: raw.previews,
      previewsTruncated: raw.matchCount > raw.previews.length,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      selector,
      matchCount: phase1Count,
      previews: [],
      previewsTruncated: phase1Count > 0,
      error: { kind: 'evaluation-failed', message },
    };
  }
}

/**
 * Query a selector by launching a browser, navigating to a URL, and querying.
 * Closes the browser in a finally block.
 */
export async function querySelectorFromUrl(
  selector: string,
  url: string,
  overrides?: Partial<QuerySelectorOptions>,
): Promise<QuerySelectorResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    return await querySelector(page, selector, overrides);
  } finally {
    await browser.close();
  }
}

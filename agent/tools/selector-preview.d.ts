// agent/tools/selector-preview.d.ts

/**
 * Request parameters for describeElements.
 * The implementation is in selector-preview.js — plain JavaScript on purpose. See
 * agent/tools/README.md, "Why selector-preview.js is JavaScript, not TypeScript".
 */
export interface SelectorPreviewRequest {
  /** Maximum number of matched elements to describe. */
  readonly maxPreviews: number;
  /** Preview text longer than this is truncated and suffixed with U+2026. */
  readonly maxPreviewTextLength: number;
}

/** One matched element, described. */
export interface SelectorMatchPreview {
  /** Zero-based position of this element among the matches. */
  readonly index: number;
  /** Lowercase tag name. */
  readonly tagName: string;
  /** The `id` attribute, or null when absent or empty. */
  readonly id: string | null;
  /** The `class` attribute split on whitespace. Empty array when absent. */
  readonly classList: readonly string[];
  /** The literal `role` attribute, or null. Implicit ARIA roles are not computed. */
  readonly role: string | null;
  /** Whitespace-collapsed, trimmed, truncated text content. Empty string, never null. */
  readonly text: string;
  /** getClientRects().length > 0 && computed visibility !== 'hidden'. */
  readonly visible: boolean;
}

/** Result returned by describeElements. */
export interface SelectorPreviewResult {
  /** Total number of matched elements, regardless of how many were described. */
  readonly matchCount: number;
  /** At most `req.maxPreviews` entries. */
  readonly previews: readonly SelectorMatchPreview[];
}

/**
 * Runs inside the browser via locator.evaluateAll. Must reference nothing outside its own
 * body except the globals `window` and `Math`.
 */
export declare function describeElements(
  elements: Element[],
  req: SelectorPreviewRequest,
): SelectorPreviewResult;

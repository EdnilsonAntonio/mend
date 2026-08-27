/**
 * Request parameters for pruneDocument.
 * The implementation is in dom-prune.js — plain JavaScript on purpose. See
 * agent/tools/README.md, "Why dom-prune.js is JavaScript, not TypeScript".
 */
export interface PruneRequest {
  readonly removeTags: readonly string[];
  readonly keepAttributes: readonly string[];
  readonly maxTextLength: number;
  readonly maxAttributeLength: number;
  readonly maxDepth: number;
}

/** Result returned by pruneDocument. */
export interface PruneResult {
  readonly html: string;
  readonly elementCount: number;
}

/**
 * Runs inside the browser via page.evaluate. Must reference nothing outside its own body.
 */
export declare function pruneDocument(req: PruneRequest): PruneResult;

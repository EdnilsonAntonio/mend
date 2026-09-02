import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClassifiedFailure } from '../classifier/failure-classifier.js';
import { healFailure } from './heal-loop.js';
import { clampSpecSource } from './prompt.js';
import type { HealResult, HealToolbox, ModelClient } from './types.js';

export interface ClosableToolbox extends HealToolbox {
  close(): Promise<void>;
}

export interface HealQueueDeps {
  readonly model: ModelClient;
  readonly appUrl: string;
  /** One toolbox per failure. The queue runner always closes what it opens. */
  readonly createToolbox: (failure: ClassifiedFailure) => Promise<ClosableToolbox>;
  /** Must never throw. Returns null when the source is unavailable. */
  readonly readSpecSource: (specFile: string) => Promise<string | null>;
  /** Forwarded verbatim to healFailure. Can lower the cap, never raise it. */
  readonly maxToolCalls?: number;
}

export interface HealQueueResult {
  readonly startedAt: string;
  readonly durationMs: number;
  /** One entry per input failure, in input order. Never shorter than the input. */
  readonly results: readonly HealResult[];
}

/**
 * Read the spec file source from disk. Resolve against the repository root.
 * Never throws — returns null on any error.
 */
export async function readSpecSourceFromDisk(specFile: string): Promise<string | null> {
  try {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const filePath = resolve(repoRoot, specFile);
    const source = await readFile(filePath, 'utf8');
    return clampSpecSource(source);
  } catch {
    return null;
  }
}

/**
 * Heal failures sequentially, reading spec sources as needed.
 * Each failure gets its own toolbox instance, closed in a finally block.
 * A throw from healFailure (only assertHealInvariant can do this) propagates
 * after the toolbox is closed.
 */
export async function healQueueSequentially(
  failures: readonly ClassifiedFailure[],
  deps: HealQueueDeps,
): Promise<HealQueueResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const results: HealResult[] = [];

  for (const failure of failures) {
    // Read the spec source — never throws
    let specSource: string | null = null;
    try {
      specSource = await deps.readSpecSource(failure.specFile);
    } catch {
      specSource = null;
    }

    // Create toolbox
    let toolbox: ClosableToolbox;
    try {
      toolbox = await deps.createToolbox(failure);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push(toolboxErrorResult(failure, deps.model.model, message));
      continue;
    }

    // Heal the failure
    try {
      results.push(
        await healFailure(failure, {
          model: deps.model,
          toolbox,
          appUrl: deps.appUrl,
          specSource,
          ...(deps.maxToolCalls === undefined ? {} : { maxToolCalls: deps.maxToolCalls }),
        }),
      );
    } finally {
      try {
        await toolbox.close();
      } catch {
        // A close failure must not mask a heal result
      }
    }
  }

  return {
    startedAt,
    durationMs: Date.now() - t0,
    results,
  };
}

/**
 * Private helper: construct a toolbox-error result.
 */
function toolboxErrorResult(
  failure: ClassifiedFailure,
  model: string,
  message: string,
): HealResult {
  return {
    specFile: failure.specFile,
    testName: failure.testName,
    originalSelector: failure.selector ?? '',
    proposedSelector: null,
    outcome: 'error',
    stopReason: 'toolbox-error',
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
    model,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    errorMessage: message,
  };
}

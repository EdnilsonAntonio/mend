import type { Page } from '@playwright/test';
import type { HealResult, HealOutcome, HealStopReason } from './types.js';

export type RequiredOutcome = 'healed' | 'no-fix' | 'either';

export interface ScenarioExpectation {
  /** 1–5, matching the table in breakage/README.md. */
  readonly scenario: number;
  readonly specFile: string;
  /** The selector the pristine spec uses; equals ClassifiedFailure.selector. */
  readonly originalSelector: string;
  readonly requiredOutcome: RequiredOutcome;
  /**
   * A selector that, on the BROKEN page, resolves to exactly the element the test was
   * written to target. null when that element no longer exists.
   */
  readonly oracleSelector: string | null;
  readonly note: string;
}

export const SCENARIO_EXPECTATIONS: readonly ScenarioExpectation[] = [
  {
    scenario: 1,
    specFile: 'tests/login-submit.spec.ts',
    originalSelector: '#login-btn',
    requiredOutcome: 'healed',
    oracleSelector: '#signin-button',
    note: 'renamed id',
  },
  {
    scenario: 2,
    specFile: 'tests/cart-add.spec.ts',
    originalSelector: '.add-to-cart',
    requiredOutcome: 'healed',
    oracleSelector: '#product-card button',
    note: 'renamed class',
  },
  {
    scenario: 3,
    specFile: 'tests/product-price.spec.ts',
    originalSelector: '#product-card > .product-card__price',
    requiredOutcome: 'either',
    oracleSelector: '.product-card__price',
    note: 'DOM restructure; heal or no-fix both acceptable, a wrong-element fix never is',
  },
  {
    scenario: 4,
    specFile: 'tests/login-validation.spec.ts',
    originalSelector: 'button:has-text("Sign In")',
    requiredOutcome: 'healed',
    oracleSelector: '#signin-button',
    note: 'changed text content',
  },
  {
    scenario: 5,
    specFile: 'tests/remember-preference.spec.ts',
    originalSelector: '#remember-me',
    requiredOutcome: 'no-fix',
    oracleSelector: null,
    note: 'element genuinely removed; no fix exists by construction',
  },
];

export type ElementIdentityVerdict =
  | 'same'
  | 'different'
  | 'proposed-not-unique'
  | 'proposed-no-match'
  | 'oracle-unavailable'
  | 'check-error';

/**
 * Check whether a proposed selector points to the same element as the oracle selector.
 * Never throws. Returns a verdict describing the result.
 */
export async function checkElementIdentity(
  page: Page,
  proposedSelector: string,
  oracleSelector: string | null,
): Promise<ElementIdentityVerdict> {
  try {
    // Step 1: oracle availability check
    if (oracleSelector === null || oracleSelector.trim() === '') {
      return 'oracle-unavailable';
    }

    // Step 2: proposed uniqueness
    const proposedCount = await page.locator(proposedSelector).count();
    if (proposedCount === 0) {
      return 'proposed-no-match';
    }
    if (proposedCount > 1) {
      return 'proposed-not-unique';
    }

    // Step 3: oracle uniqueness
    const oracleCount = await page.locator(oracleSelector).count();
    if (oracleCount !== 1) {
      return 'oracle-unavailable';
    }

    // Step 4: element identity check
    const handle = await page.locator(oracleSelector).elementHandle();
    if (handle === null) {
      return 'oracle-unavailable';
    }

    try {
      const same = await page
        .locator(proposedSelector)
        .evaluate((el, other) => el === other, handle);
      return same ? 'same' : 'different';
    } finally {
      await handle.dispose();
    }
  } catch {
    return 'check-error';
  }
}

export type ScenarioFailureReason =
  | 'unknown-scenario'
  | 'heal-error'
  | 'expected-healed-but-not'
  | 'expected-no-fix-but-healed'
  | 'wrong-element-fix'
  | 'fix-not-unique'
  | 'identity-check-failed';

export interface ScenarioVerdict {
  readonly scenario: number;
  readonly specFile: string;
  readonly requiredOutcome: RequiredOutcome;
  readonly outcome: HealOutcome;
  readonly stopReason: HealStopReason;
  readonly proposedSelector: string | null;
  readonly toolCallCount: number;
  readonly capReached: boolean;
  readonly durationMs: number;
  /** null when no fix was proposed — there is nothing to check. */
  readonly identity: ElementIdentityVerdict | null;
  readonly pass: boolean;
  /** Empty if and only if `pass` is true. Ordered as evaluated. */
  readonly failureReasons: readonly ScenarioFailureReason[];
}

/**
 * Evaluate a single heal result against a scenario expectation.
 */
export function evaluateScenario(
  result: HealResult,
  identity: ElementIdentityVerdict | null,
  expectations?: readonly ScenarioExpectation[],
): ScenarioVerdict {
  const exps = expectations ?? SCENARIO_EXPECTATIONS;

  // Step 1: find the expectation
  const expectation = exps.find((e) => e.specFile === result.specFile);
  if (expectation === undefined) {
    return {
      scenario: 0,
      specFile: result.specFile,
      requiredOutcome: 'either',
      outcome: result.outcome,
      stopReason: result.stopReason,
      proposedSelector: result.proposedSelector,
      toolCallCount: result.toolCallCount,
      capReached: result.capReached,
      durationMs: result.durationMs,
      identity,
      pass: false,
      failureReasons: ['unknown-scenario'],
    };
  }

  // Step 2–6: collect failure reasons
  const reasons: ScenarioFailureReason[] = [];

  // Step 3: heal error
  if (result.outcome === 'error') {
    reasons.push('heal-error');
  }

  // Step 4: expected healed but not
  if (expectation.requiredOutcome === 'healed' && result.outcome !== 'healed') {
    reasons.push('expected-healed-but-not');
  }

  // Step 5: expected no-fix but healed
  if (expectation.requiredOutcome === 'no-fix' && result.proposedSelector !== null) {
    reasons.push('expected-no-fix-but-healed');
  }

  // Step 6: element identity issues (only if a fix was proposed)
  if (result.proposedSelector !== null) {
    switch (identity) {
      case 'same':
        // All good, no reason
        break;
      case 'different':
        reasons.push('wrong-element-fix');
        break;
      case 'proposed-not-unique':
        reasons.push('fix-not-unique');
        break;
      case 'proposed-no-match':
      case 'oracle-unavailable':
      case 'check-error':
      case null:
        reasons.push('identity-check-failed');
        break;
    }
  }

  // Step 7: compute pass
  const pass = reasons.length === 0;

  return {
    scenario: expectation.scenario,
    specFile: expectation.specFile,
    requiredOutcome: expectation.requiredOutcome,
    outcome: result.outcome,
    stopReason: result.stopReason,
    proposedSelector: result.proposedSelector,
    toolCallCount: result.toolCallCount,
    capReached: result.capReached,
    durationMs: result.durationMs,
    identity,
    pass,
    failureReasons: reasons,
  };
}

export interface RunVerdict {
  readonly run: number;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly scenarios: readonly ScenarioVerdict[];
  readonly missingSpecFiles: readonly string[];
  readonly pass: boolean;
}

/**
 * Evaluate a single run's verdicts.
 */
export function evaluateRun(
  run: number,
  startedAt: string,
  durationMs: number,
  scenarios: readonly ScenarioVerdict[],
  expectedSpecFiles: readonly string[],
): RunVerdict {
  // Check for missing spec files
  const missingSpecFiles = expectedSpecFiles.filter(
    (spec) => !scenarios.some((s) => s.specFile === spec),
  );

  // A run passes iff all scenarios pass and no files are missing
  const pass = scenarios.every((s) => s.pass) && missingSpecFiles.length === 0;

  return {
    run,
    startedAt,
    durationMs,
    scenarios,
    missingSpecFiles,
    pass,
  };
}

export interface ScenarioSummary {
  readonly scenario: number;
  readonly specFile: string;
  readonly requiredOutcome: RequiredOutcome;
  readonly attempts: number;
  readonly healed: number;
  readonly noFix: number;
  readonly errors: number;
  readonly wrongElement: number;
  readonly passes: number;
  /** attempts > 0 && passes === attempts */
  readonly pass: boolean;
  /** Mean toolCallCount across attempts, rounded to 2 decimals. 0 when attempts is 0. */
  readonly averageToolCalls: number;
}

export interface MatrixVerdict {
  readonly runs: number;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly model: string;
  readonly runVerdicts: readonly RunVerdict[];
  /** One entry per expected spec file, in SCENARIO_EXPECTATIONS order. */
  readonly perScenario: readonly ScenarioSummary[];
  readonly pass: boolean;
}

/**
 * Summarize the entire matrix across all runs.
 */
export function summariseMatrix(
  startedAt: string,
  durationMs: number,
  model: string,
  runVerdicts: readonly RunVerdict[],
  expectations?: readonly ScenarioExpectation[],
): MatrixVerdict {
  const exps = expectations ?? SCENARIO_EXPECTATIONS;

  // Flatten all verdicts and index by spec file
  const verdictsBySpecFile = new Map<string, ScenarioVerdict[]>();
  for (const runVerdict of runVerdicts) {
    for (const scenarioVerdict of runVerdict.scenarios) {
      if (!verdictsBySpecFile.has(scenarioVerdict.specFile)) {
        verdictsBySpecFile.set(scenarioVerdict.specFile, []);
      }
      verdictsBySpecFile.get(scenarioVerdict.specFile)!.push(scenarioVerdict);
    }
  }

  // Build per-scenario summaries
  const perScenario: ScenarioSummary[] = [];
  for (const expectation of exps) {
    const verdicts = verdictsBySpecFile.get(expectation.specFile) ?? [];
    const attempts = verdicts.length;

    let healed = 0;
    let noFix = 0;
    let errors = 0;
    let wrongElement = 0;
    let passes = 0;
    let totalToolCalls = 0;

    for (const verdict of verdicts) {
      if (verdict.outcome === 'healed') {
        healed++;
      } else if (verdict.outcome === 'no-fix') {
        noFix++;
      } else {
        errors++;
      }

      if (verdict.failureReasons.includes('wrong-element-fix')) {
        wrongElement++;
      }

      if (verdict.pass) {
        passes++;
      }

      totalToolCalls += verdict.toolCallCount;
    }

    const averageToolCalls = attempts > 0 ? Math.round((totalToolCalls / attempts) * 100) / 100 : 0;
    const pass = attempts > 0 && passes === attempts;

    perScenario.push({
      scenario: expectation.scenario,
      specFile: expectation.specFile,
      requiredOutcome: expectation.requiredOutcome,
      attempts,
      healed,
      noFix,
      errors,
      wrongElement,
      passes,
      pass,
      averageToolCalls,
    });
  }

  // A matrix passes iff all run verdicts pass and all scenario summaries pass
  const pass =
    runVerdicts.length > 0 &&
    runVerdicts.every((r) => r.pass) &&
    perScenario.every((s) => s.pass);

  return {
    runs: runVerdicts.length,
    startedAt,
    durationMs,
    model,
    runVerdicts,
    perScenario,
    pass,
  };
}

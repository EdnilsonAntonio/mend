import { extractStringLiterals } from './spec-edit.js';

export type IntegrityRuleId =
  | 'expect-count'
  | 'matcher-inventory'
  | 'negation-count'
  | 'await-count'
  | 'skip-only'
  | 'comment-count'
  | 'line-count'
  | 'string-literals';

export interface IntegrityViolation {
  readonly rule: IntegrityRuleId;
  /** Human-readable, never empty. Tests must not assert on its exact text. */
  readonly detail: string;
}

export interface AssertionIntegrityResult {
  /** True iff `violations` is empty. */
  readonly ok: boolean;
  /** Every violation found, in rule order. Never partial. */
  readonly violations: readonly IntegrityViolation[];
}

/** The single string-literal change the substitution is permitted to make. */
export interface AllowedLiteralChange {
  /** Exact source text, including quotes, e.g. `'#login-btn'`. */
  readonly fromLiteral: string;
  /** Exact source text, including quotes, e.g. `'#signin-button'`. */
  readonly toLiteral: string;
}

export interface SpecLineChange {
  /** 1-based line number. */
  readonly lineNumber: number;
  readonly before: string;
  readonly after: string;
}

export const ASSERTION_MATCHERS: readonly string[] = [
  'toBeVisible', 'toBeHidden', 'toBeAttached', 'toBeFocused', 'toBeEditable',
  'toBeEnabled', 'toBeDisabled', 'toBeChecked', 'toBeEmpty',
  'toHaveText', 'toContainText', 'toHaveValue', 'toHaveValues', 'toHaveCount',
  'toHaveAttribute', 'toHaveClass', 'toHaveId', 'toHaveCSS', 'toHaveJSProperty',
  'toHaveURL', 'toHaveTitle', 'toHaveScreenshot', 'toMatchAriaSnapshot',
  'toBe', 'toEqual', 'toStrictEqual', 'toContain', 'toMatch', 'toMatchObject',
  'toThrow', 'toThrowError', 'toBeTruthy', 'toBeFalsy', 'toBeNull', 'toBeUndefined',
  'toBeDefined', 'toBeNaN', 'toBeCloseTo', 'toBeGreaterThan', 'toBeGreaterThanOrEqual',
  'toBeLessThan', 'toBeLessThanOrEqual', 'toBeInstanceOf', 'toHaveLength',
  'toHaveProperty',
];

function countMatches(source: string, pattern: RegExp): number {
  const freshPattern = new RegExp(pattern.source, pattern.flags);
  const matches = source.match(freshPattern);
  return matches ? matches.length : 0;
}

export function checkAssertionIntegrity(
  originalSource: string,
  proposedSource: string,
  allowedLiteralChange: AllowedLiteralChange | null,
): AssertionIntegrityResult {
  const violations: IntegrityViolation[] = [];

  // Rule 1: expect-count
  const originalExpectCount = countMatches(originalSource, /\bexpect\s*\(/g);
  const proposedExpectCount = countMatches(proposedSource, /\bexpect\s*\(/g);
  if (proposedExpectCount < originalExpectCount) {
    violations.push({
      rule: 'expect-count',
      detail: `expect( occurrences ${originalExpectCount} -> ${proposedExpectCount}`,
    });
  }

  // Rule 2: matcher-inventory
  for (const matcher of ASSERTION_MATCHERS) {
    const pattern = new RegExp('\\.' + matcher + '\\s*\\(', 'g');
    const originalCount = countMatches(originalSource, pattern);
    const proposedCount = countMatches(proposedSource, pattern);
    if (proposedCount !== originalCount) {
      violations.push({
        rule: 'matcher-inventory',
        detail: `.${matcher}( occurrences ${originalCount} -> ${proposedCount}`,
      });
    }
  }

  // Rule 3: negation-count
  const originalNegationCount = countMatches(originalSource, /\.not\b/g);
  const proposedNegationCount = countMatches(proposedSource, /\.not\b/g);
  if (proposedNegationCount !== originalNegationCount) {
    violations.push({
      rule: 'negation-count',
      detail: `.not occurrences ${originalNegationCount} -> ${proposedNegationCount}`,
    });
  }

  // Rule 4: await-count
  const originalAwaitCount = countMatches(originalSource, /\bawait\b/g);
  const proposedAwaitCount = countMatches(proposedSource, /\bawait\b/g);
  if (proposedAwaitCount !== originalAwaitCount) {
    violations.push({
      rule: 'await-count',
      detail: `await occurrences ${originalAwaitCount} -> ${proposedAwaitCount}`,
    });
  }

  // Rule 5: skip-only
  const originalSkipOnlyCount = countMatches(originalSource, /\.\s*(?:skip|only|fixme|fail|soft)\b/g);
  const proposedSkipOnlyCount = countMatches(proposedSource, /\.\s*(?:skip|only|fixme|fail|soft)\b/g);
  if (proposedSkipOnlyCount > originalSkipOnlyCount) {
    violations.push({
      rule: 'skip-only',
      detail: `.skip/.only/.fixme/.fail/.soft occurrences ${originalSkipOnlyCount} -> ${proposedSkipOnlyCount}`,
    });
  }

  // Rule 6: comment-count
  const originalCommentCount = countMatches(originalSource, /\/\/|\/\*/g);
  const proposedCommentCount = countMatches(proposedSource, /\/\/|\/\*/g);
  if (proposedCommentCount > originalCommentCount) {
    violations.push({
      rule: 'comment-count',
      detail: `comment markers ${originalCommentCount} -> ${proposedCommentCount}`,
    });
  }

  // Rule 7: line-count
  const originalLineCount = originalSource.split('\n').length;
  const proposedLineCount = proposedSource.split('\n').length;
  if (proposedLineCount !== originalLineCount) {
    violations.push({
      rule: 'line-count',
      detail: `line count ${originalLineCount} -> ${proposedLineCount}`,
    });
  }

  // Rule 8: string-literals
  const originalLiterals = extractStringLiterals(originalSource);
  const proposedLiterals = extractStringLiterals(proposedSource);

  // Build count maps
  const originalCounts = new Map<string, number>();
  for (const lit of originalLiterals) {
    originalCounts.set(lit, (originalCounts.get(lit) ?? 0) + 1);
  }

  const proposedCounts = new Map<string, number>();
  for (const lit of proposedLiterals) {
    proposedCounts.set(lit, (proposedCounts.get(lit) ?? 0) + 1);
  }

  // Find removed and added literals
  const removed: string[] = [];
  for (const lit of originalLiterals) {
    const origCount = originalCounts.get(lit) ?? 0;
    const propCount = proposedCounts.get(lit) ?? 0;
    if (propCount < origCount) {
      for (let i = 0; i < origCount - propCount; i++) {
        removed.push(lit);
      }
      // Mark this literal as processed to maintain order
      originalCounts.delete(lit);
    }
  }

  const added: string[] = [];
  for (const lit of proposedLiterals) {
    const origCount = originalCounts.get(lit) ?? 0;
    const propCount = proposedCounts.get(lit) ?? 0;
    if (propCount > origCount) {
      for (let i = 0; i < propCount - origCount; i++) {
        added.push(lit);
      }
      // Mark this literal as processed to maintain order
      proposedCounts.delete(lit);
    }
  }

  // Check if the change is allowed
  const literalChangeOk =
    (removed.length === 0 && added.length === 0) ||
    (allowedLiteralChange !== null &&
      removed.length === 1 &&
      added.length === 1 &&
      removed[0] === allowedLiteralChange.fromLiteral &&
      added[0] === allowedLiteralChange.toLiteral);

  if (!literalChangeOk) {
    violations.push({
      rule: 'string-literals',
      detail: `unexpected string literal changes: removed [${removed.join(', ')}] added [${added.join(', ')}]`,
    });
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

export function diffChangedLines(
  originalSource: string,
  proposedSource: string,
): readonly SpecLineChange[] {
  const originalLines = originalSource.split('\n');
  const proposedLines = proposedSource.split('\n');

  if (originalLines.length !== proposedLines.length) {
    return [];
  }

  const changes: SpecLineChange[] = [];
  for (let i = 0; i < originalLines.length; i++) {
    const lineNumber = i + 1;
    const before = originalLines[i];
    const after = proposedLines[i];

    if (before !== after) {
      const beforeStr = before ?? '';
      const afterStr = after ?? '';
      changes.push({ lineNumber, before: beforeStr, after: afterStr });
    }
  }

  return changes;
}

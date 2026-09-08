import { applySelectorSubstitution } from '../agent/tools/spec-edit.js';
import {
  checkAssertionIntegrity,
  diffChangedLines,
  type SpecLineChange,
} from '../agent/tools/assertion-integrity.js';
import type { HealAssessment } from '../agent/loop/confidence.js';
import { TOOL_CALL_COUNT_CEILING } from '../db/schema-contract.js';

export const PR_BRANCH_PREFIX = 'mend/heal';
export const MAX_PR_BODY_CHARS = 60_000;
export const MAX_PR_OUTPUT_CHARS = 4_000;
export const PR_FOOTER =
  'Opened by Self-Healing E2E Tests. A human must review and merge — this tool never merges.';

export type PatchFailureCode =
  | 'substitution-failed'
  | 'assertion-integrity'
  | 'no-changed-lines';

export type PatchResult =
  | {
      readonly ok: true;
      /** The complete patched spec source. Never written to disk. */
      readonly proposedSource: string;
      readonly fromLiteral: string;
      readonly toLiteral: string;
      readonly changedLines: readonly SpecLineChange[];
      /** Display-only unified diff for the PR body. Never applied. */
      readonly diff: string;
    }
  | {
      readonly ok: false;
      readonly code: PatchFailureCode;
      readonly message: string;
    };

/**
 * Structurally compatible with `checkAssertionIntegrity`. Injectable ONLY so the
 * assertion-integrity branch of `buildPatch` is unit-testable. Production callers pass nothing.
 */
export type AssertionIntegrityChecker = (
  originalSource: string,
  proposedSource: string,
  allowedLiteralChange: { readonly fromLiteral: string; readonly toLiteral: string } | null,
) => {
  readonly ok: boolean;
  readonly violations: readonly { readonly rule: string; readonly detail: string }[];
};

export interface PrBodyInput {
  readonly assessment: HealAssessment;
  readonly diff: string;
  readonly changedLines: readonly SpecLineChange[];
  readonly branch: string;
  readonly baseBranch: string;
}

/**
 * Replace every ASCII control character with a single space, collapse runs of whitespace,
 * and clamp to maxChars with ellipsis.
 */
export function sanitiseOneLine(text: string, maxChars: number): string {
  // Replace control characters and tabs with spaces
  const replaced = text.replace(/[\x00-\x1f\x7f]/g, ' ');
  // Collapse runs of whitespace
  const collapsed = replaced.replace(/\s+/g, ' ').trim();
  // Clamp with ellipsis
  if (collapsed.length > maxChars) {
    return collapsed.slice(0, maxChars - 1) + '…';
  }
  return collapsed;
}

/**
 * Slugify a spec file path: extract basename, strip extension, lowercase, replace non-alphanumeric
 * with dashes, clamp to 40 chars, ensure non-empty.
 */
export function slugifySpecFile(specFile: string): string {
  // Get basename (substring after last /)
  const basename = specFile.includes('/')
    ? specFile.substring(specFile.lastIndexOf('/') + 1)
    : specFile;

  // Strip trailing .spec.ts or .ts
  let slug = basename;
  if (slug.endsWith('.spec.ts')) {
    slug = slug.slice(0, -8);
  } else if (slug.endsWith('.ts')) {
    slug = slug.slice(0, -3);
  }

  // Lowercase and replace non-alphanumeric with dashes
  slug = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // Strip leading and trailing dashes
  slug = slug.replace(/^-+|-+$/g, '');

  // Clamp to 40 chars
  if (slug.length > 40) {
    slug = slug.slice(0, 40);
  }

  // Strip trailing dash again
  slug = slug.replace(/-+$/, '');

  // Ensure non-empty
  return slug || 'spec';
}

/**
 * Build a unique branch name from spec file and attempt ID.
 */
export function buildBranchName(specFile: string, attemptId: string): string {
  const slug = slugifySpecFile(specFile);
  // Get first 8 hex chars from UUID (removing dashes)
  const hexId = attemptId.replace(/-/g, '').slice(0, 8) || '00000000';
  return `${PR_BRANCH_PREFIX}/${slug}-${hexId}`;
}

/**
 * Build a concise PR title from the assessment.
 */
export function buildPrTitle(assessment: HealAssessment): string {
  const basename = assessment.result.specFile.includes('/')
    ? assessment.result.specFile.substring(assessment.result.specFile.lastIndexOf('/') + 1)
    : assessment.result.specFile;
  const title = `fix(e2e): heal selector in ${basename}`;
  return sanitiseOneLine(title, 120);
}

/**
 * Build the commit message body.
 */
export function buildCommitMessage(assessment: HealAssessment): string {
  const specFile = sanitiseOneLine(assessment.result.specFile, 200);
  const originalSelector = sanitiseOneLine(assessment.result.originalSelector, 200);
  const proposedSelector = sanitiseOneLine(
    assessment.result.proposedSelector ?? '',
    200,
  );
  const testName = sanitiseOneLine(assessment.result.testName, 200);

  return `fix(e2e): heal selector in ${specFile}

Replace ${originalSelector} with ${proposedSelector} in test "${testName}".
Verified by re-executing the single affected test; assertion integrity checked.`;
}

/**
 * Build a unified diff for display in the PR body (not for patching).
 */
export function buildUnifiedDiff(
  specFile: string,
  changedLines: readonly SpecLineChange[],
): string {
  const lines: string[] = [
    `--- a/${specFile}`,
    `+++ b/${specFile}`,
  ];

  for (const change of changedLines) {
    lines.push(`@@ -${change.lineNumber},1 +${change.lineNumber},1 @@`);
    lines.push(`-${change.before}`);
    lines.push(`+${change.after}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Apply selector substitution and verify assertion integrity before returning ok: true.
 */
export function buildPatch(
  assessment: HealAssessment,
  originalSource: string,
  checkIntegrity: AssertionIntegrityChecker = checkAssertionIntegrity,
): PatchResult {
  const selector = assessment.result.proposedSelector;
  if (selector === null) {
    return {
      ok: false,
      code: 'substitution-failed',
      message: 'no proposed selector',
    };
  }

  const sub = applySelectorSubstitution(
    originalSource,
    assessment.result.originalSelector,
    selector,
  );

  if (
    !sub.ok ||
    sub.proposedSource === null ||
    sub.fromLiteral === null ||
    sub.toLiteral === null
  ) {
    return {
      ok: false,
      code: 'substitution-failed',
      message: `${sub.failure ?? 'unknown'}: ${sub.detail}`,
    };
  }

  // Non-negotiable integrity check before any ok: true
  const integrity = checkIntegrity(originalSource, sub.proposedSource, {
    fromLiteral: sub.fromLiteral,
    toLiteral: sub.toLiteral,
  });

  if (!integrity.ok) {
    return {
      ok: false,
      code: 'assertion-integrity',
      message: integrity.violations
        .map((v) => `${v.rule}: ${v.detail}`)
        .join('; '),
    };
  }

  const changedLines = diffChangedLines(originalSource, sub.proposedSource);
  if (changedLines.length === 0) {
    return {
      ok: false,
      code: 'no-changed-lines',
      message: 'proposed source is identical to the original',
    };
  }

  return {
    ok: true,
    proposedSource: sub.proposedSource,
    fromLiteral: sub.fromLiteral,
    toLiteral: sub.toLiteral,
    changedLines,
    diff: buildUnifiedDiff(assessment.result.specFile, changedLines),
  };
}

/**
 * Sanitise output by replacing triple backticks and clamping to last N chars.
 */
function sanitiseOutput(text: string): string {
  // Replace every occurrence of three backticks with single quote
  const sanitised = text.replace(/```/g, "'");

  // Clamp to MAX_PR_OUTPUT_CHARS, keeping the last N chars
  if (sanitised.length > MAX_PR_OUTPUT_CHARS) {
    const suffix = '…[output truncated]…\n';
    const start = sanitised.length - MAX_PR_OUTPUT_CHARS + suffix.length;
    return suffix + sanitised.slice(Math.max(0, start));
  }

  return sanitised;
}

/**
 * Build the full PR body with all sections.
 */
export function buildPrBody(input: PrBodyInput): string {
  const specFile = sanitiseOneLine(input.assessment.result.specFile, 200).replace(/\|/g, '\\|');
  const testName = sanitiseOneLine(input.assessment.result.testName, 200).replace(/\|/g, '\\|');
  const originalSelector = sanitiseOneLine(
    input.assessment.result.originalSelector,
    200,
  ).replace(/\|/g, '\\|');
  const proposedSelector = sanitiseOneLine(
    input.assessment.result.proposedSelector ?? '',
    200,
  ).replace(/\|/g, '\\|');

  // Verification section
  const verification = input.assessment.result.verification;
  const verificationOutput = sanitiseOutput(verification?.output ?? '');
  const verificationExecuted = verification !== null;
  const verificationPassed = verification?.passed ?? false;
  const verificationDuration = verification?.durationMs ?? 0;

  // Measurement
  const matchCount = input.assessment.measurement?.matchCount ?? null;
  const matchCountDisplay = matchCount !== null ? String(matchCount) : '-';

  // Build sections
  const sections: string[] = [];

  // Summary
  sections.push('## Summary\n');
  sections.push('An automated selector fix produced by Self-Healing E2E Tests.\n');
  sections.push('| Field | Value |');
  sections.push('| --- | --- |');
  sections.push(`| Spec file | \`${specFile}\` |`);
  sections.push(`| Test | \`${testName}\` |`);
  sections.push(`| Original selector | \`${originalSelector}\` |`);
  sections.push(`| Proposed selector | \`${proposedSelector}\` |`);
  sections.push(`| Branch | \`${input.branch}\` -> \`${input.baseBranch}\` |`);

  // Verification
  sections.push('');
  sections.push('## Verification\n');
  sections.push('The single affected test was re-executed against a temporary copy of the spec file and passed.');
  sections.push('A fix is never accepted on the model\'s word alone.\n');
  sections.push(`- executed: ${verificationExecuted}`);
  sections.push(`- passed: ${verificationPassed}`);
  sections.push(`- duration: ${verificationDuration}ms\n`);
  sections.push('```text');
  sections.push(verificationOutput);
  sections.push('```');

  // Assertion integrity
  sections.push('');
  sections.push('## Assertion integrity\n');
  sections.push('The proposed spec was diffed against the original and re-checked before this commit was');
  sections.push('created. No assertion was removed, weakened, skipped, or marked `.only`.\n');
  sections.push('Changed lines:\n');
  sections.push('| Line | Before | After |');
  sections.push('| --- | --- | --- |');
  for (const change of input.changedLines) {
    const before = sanitiseOneLine(change.before, 200).replace(/\|/g, '\\|');
    const after = sanitiseOneLine(change.after, 200).replace(/\|/g, '\\|');
    sections.push(`| ${change.lineNumber} | \`${before}\` | \`${after}\` |`);
  }

  // Confidence
  sections.push('');
  sections.push('## Confidence\n');
  sections.push('Confidence is derived from observable signals only, never from the model\'s self-report.\n');
  sections.push('- level: high');
  sections.push(`- measured DOM matches for the proposed selector: ${matchCountDisplay}`);
  sections.push(`- model-initiated tool calls: ${input.assessment.result.toolCallCount}`);

  // Agent tool calls
  sections.push('');
  sections.push('## Agent tool calls\n');
  const toolCalls = input.assessment.result.transcript.toolCalls.slice(0, TOOL_CALL_COUNT_CEILING);
  if (toolCalls.length === 0) {
    sections.push('_No tool calls were recorded._');
  } else {
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      if (!call) continue; // Guard against sparse arrays
      const argsJson = JSON.stringify(call.arguments);
      const args = argsJson.length > 200
        ? argsJson.slice(0, 197) + '…'
        : argsJson;
      const resultSummary = sanitiseOneLine(call.resultSummary, 300);
      sections.push(`${i + 1}. \`${call.tool}\` — args \`${args}\` -> ${resultSummary}`);
    }
  }

  // Diff
  sections.push('');
  sections.push('## Diff\n');
  sections.push('```diff');
  sections.push(input.diff.slice(0, -1)); // Remove trailing newline from diff
  sections.push('```');

  // Footer
  sections.push('');
  sections.push(PR_FOOTER);

  let body = sections.join('\n');

  // Final clamp
  const PR_TRUNCATION_SUFFIX = '\n\n…[body truncated]…\n\n' + PR_FOOTER;
  if (body.length > MAX_PR_BODY_CHARS) {
    body = body.slice(0, MAX_PR_BODY_CHARS - PR_TRUNCATION_SUFFIX.length) + PR_TRUNCATION_SUFFIX;
  }

  return body;
}

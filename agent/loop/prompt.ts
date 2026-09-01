import type { ClassifiedFailure } from '../classifier/failure-classifier.js';
import type { DomSnapshot } from '../tools/get-dom-snapshot.js';
import type { ChatMessage } from './types.js';
import { MAX_TOOL_RESULT_CHARS } from './tool-schemas.js';

export const SYSTEM_PROMPT = `You repair a single broken Playwright end-to-end test whose selector no longer matches
anything on the page. You are not fixing the application and you are not changing what the
test checks.

Rules you cannot change:
1. You may propose a replacement for exactly ONE selector: the original selector given below.
   You cannot edit the test, its assertions, or any other selector.
2. A fix exists only if run_single_test reports passed=true. Your own certainty counts for
   nothing. Never state that the test is fixed unless you have called run_single_test and seen
   passed=true in its result.
3. You have at most 5 tool calls in total for this whole task. Spend them deliberately.
4. query_selector tells you what a selector matches. It never verifies a fix.
5. Prefer a selector that matches exactly one element and that identifies the same element the
   original selector was written to target.
6. If the element the test needs no longer exists on the page, say so plainly and stop calling
   tools. "No fix found" is a correct and expected answer. Never point the selector at a
   different element just to make the test go green.

Work efficiently: find the drifted element in the DOM snapshot, confirm it with query_selector
if you are unsure, then verify it with run_single_test.`;

export function buildInitialMessages(
  failure: ClassifiedFailure,
  appUrl: string,
  snapshot: DomSnapshot,
): readonly ChatMessage[] {
  const clampedHtml = clampHead(snapshot.html, MAX_TOOL_RESULT_CHARS);
  const userMessage = `Spec file: ${failure.specFile}
Test name: ${failure.testName}
Original selector: ${failure.selector ?? ''}
Page URL: ${appUrl}
Classifier rule: ${failure.rule}

Playwright error:
${failure.errorText}

Pruned DOM snapshot of the page (captured now, before you start):
${clampedHtml}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];
}

function clampHead(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + '\n…[truncated]…';
}

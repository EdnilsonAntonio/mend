import { test, expect } from '@playwright/test';
import {
  formatTimestamp,
  statusLabel,
  confidenceLabel,
  statusBadgeClass,
  confidenceBadgeClass,
  truncate,
  shortId,
  isSafePrUrl,
  prLinkLabel,
  redactConnectionUrls,
  clampForDisplay,
  toolLabel,
  formatDuration,
  formatJson,
  matchCountLabel,
  booleanLabel,
  noPrExplanation,
  EMPTY_CELL,
} from '../lib/format';
import { HEAL_STATUS_VALUES, HEAL_CONFIDENCE_VALUES } from '../lib/types';

test('formatTimestamp: valid ISO string', () => {
  const result = formatTimestamp('2025-01-02T03:04:05.000Z');
  expect(result).toBe('2025-01-02 03:04:05 UTC');
});

test('formatTimestamp: invalid string', () => {
  const result = formatTimestamp('not a date');
  expect(result).toBe('not a date');
});

test('statusLabel: all four values', () => {
  expect(statusLabel('investigating')).toBe('Investigating');
  expect(statusLabel('healed')).toBe('Healed');
  expect(statusLabel('needs_review')).toBe('Needs review');
  expect(statusLabel('failed')).toBe('Failed');
  expect(HEAL_STATUS_VALUES).toHaveLength(4);
});

test('confidenceLabel: all three values', () => {
  expect(confidenceLabel('high')).toBe('High');
  expect(confidenceLabel('low')).toBe('Low');
  expect(confidenceLabel('none')).toBe('None');
  expect(HEAL_CONFIDENCE_VALUES).toHaveLength(3);
});

test('statusBadgeClass and confidenceBadgeClass', () => {
  expect(statusBadgeClass('needs_review')).toBe('badge badge-status-needs_review');
  expect(confidenceBadgeClass('high')).toBe('badge badge-confidence-high');
});

test('truncate: with limit exceeded', () => {
  expect(truncate('abcdef', 4)).toBe('abc…');
});

test('truncate: within limit', () => {
  expect(truncate('abc', 10)).toBe('abc');
});

test('shortId: valid UUID', () => {
  expect(shortId('0f9c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b')).toBe('0f9c1a2b');
});

test('isSafePrUrl: https is safe', () => {
  expect(isSafePrUrl('https://github.com/o/r/pull/7')).toBe(true);
});

test('isSafePrUrl: javascript is unsafe', () => {
  expect(isSafePrUrl('javascript:alert(1)')).toBe(false);
});

test('isSafePrUrl: http is unsafe', () => {
  expect(isSafePrUrl('http://x')).toBe(false);
});

test('prLinkLabel: extracts PR number', () => {
  expect(prLinkLabel('https://github.com/o/r/pull/7')).toBe('#7');
});

test('prLinkLabel: generic PR', () => {
  expect(prLinkLabel('https://example.com/x')).toBe('PR');
});

test('redactConnectionUrls: redacts postgres URLs', () => {
  const result = redactConnectionUrls('connect ECONNREFUSED postgres://alice:hunter2@db:5432/mend');
  expect(result).toContain('postgres://***');
  expect(result).not.toContain('hunter2');
  expect(result).not.toContain('alice');
});

test('redactConnectionUrls: no secrets', () => {
  const result = redactConnectionUrls('no secrets here');
  expect(result).toBe('no secrets here');
});

test('clampForDisplay: exceeds limit', () => {
  const result = clampForDisplay('abcdef', 3);
  expect(result).toEqual({ text: 'abc', clamped: true, originalLength: 6 });
});

test('clampForDisplay: within limit', () => {
  const result = clampForDisplay('abc', 10);
  expect(result).toEqual({ text: 'abc', clamped: false, originalLength: 3 });
});

test('clampForDisplay: zero max chars', () => {
  expect(clampForDisplay('abc', 0)).toEqual({ text: '', clamped: true, originalLength: 3 });
  expect(clampForDisplay('', 0).clamped).toBe(false);
});

test('clampForDisplay: no ellipsis', () => {
  expect(clampForDisplay('abcdef', 3).text).not.toContain('…');
});

test('toolLabel: known tools', () => {
  expect(toolLabel('run_single_test')).toBe('Run single test');
  expect(toolLabel('get_dom_snapshot')).toBe('DOM snapshot');
  expect(toolLabel('query_selector')).toBe('Query selector');
  expect(toolLabel('made_up')).toBe('made_up');
  expect(toolLabel('')).toBe('');
});

test('formatDuration: null and negative', () => {
  expect(formatDuration(null)).toBe(EMPTY_CELL);
  expect(formatDuration(-1)).toBe(EMPTY_CELL);
});

test('formatDuration: milliseconds', () => {
  expect(formatDuration(0)).toBe('0ms');
  expect(formatDuration(999)).toBe('999ms');
});

test('formatDuration: seconds', () => {
  expect(formatDuration(1500)).toBe('1.5s');
});

test('formatJson: valid object', () => {
  const result = formatJson({ a: 1 });
  expect(result).toContain('"a": 1');
});

test('formatJson: undefined', () => {
  expect(formatJson(undefined)).toBe('undefined');
});

test('matchCountLabel: null and zero', () => {
  expect(matchCountLabel(null)).toBe('not measured');
  expect(matchCountLabel(0)).toBe('0 matches');
});

test('matchCountLabel: singular and plural', () => {
  expect(matchCountLabel(1)).toBe('1 match');
  expect(matchCountLabel(3)).toBe('3 matches');
});

test('booleanLabel: all cases', () => {
  expect(booleanLabel(null)).toBe(EMPTY_CELL);
  expect(booleanLabel(true)).toBe('yes');
  expect(booleanLabel(false)).toBe('no');
});

test('noPrExplanation: all statuses distinct and non-empty', () => {
  const healed = noPrExplanation('healed');
  const needsReview = noPrExplanation('needs_review');
  const failed = noPrExplanation('failed');
  const investigating = noPrExplanation('investigating');

  expect(healed).not.toBe('');
  expect(needsReview).not.toBe('');
  expect(failed).not.toBe('');
  expect(investigating).not.toBe('');

  const explanations = new Set([healed, needsReview, failed, investigating]);
  expect(explanations.size).toBe(4);

  [healed, needsReview, failed, investigating].forEach((exp) => {
    expect(exp).not.toContain('merge');
  });
});

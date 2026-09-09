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

import { test, expect } from '@playwright/test';
import {
  ATTEMPT_LIST_LIMIT,
  MAX_ATTEMPT_LIST_LIMIT,
  toHealAttemptListRow,
  DashboardDataError,
  listHealAttempts,
  summariseAttempts,
  loadAttempts,
  resolveLimit,
} from '../lib/attempts';
import type { RowReader } from '../lib/attempts';

function recordingReader(rows: readonly Record<string, unknown>[]) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const read: RowReader = async (text, values) => {
    calls.push({ text, values });
    return rows;
  };
  return { read, calls };
}

test('Query is read-only: starts with SELECT', async () => {
  const { read, calls } = recordingReader([]);
  await listHealAttempts(read);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.text).toMatch(/^\s*SELECT\b/i);
});

test('Query contains no write verbs', async () => {
  const { read, calls } = recordingReader([]);
  await listHealAttempts(read);

  expect(calls[0]?.text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i);
});

test('Query does not select transcript', async () => {
  const { read, calls } = recordingReader([]);
  await listHealAttempts(read);

  expect(calls[0]?.text).not.toContain('transcript');
});

test('Query contains ORDER BY created_at DESC, id DESC', async () => {
  const { read, calls } = recordingReader([]);
  await listHealAttempts(read);

  expect(calls[0]?.text).toContain('ORDER BY created_at DESC, id DESC');
});

test('Query contains LIMIT $1', async () => {
  const { read, calls } = recordingReader([]);
  await listHealAttempts(read);

  expect(calls[0]?.text).toContain('LIMIT $1');
});

test('Query selects from heal_attempts', async () => {
  const { read, calls } = recordingReader([]);
  await listHealAttempts(read);

  expect(calls[0]?.text).toContain('FROM heal_attempts');
});

test('Query passes limit value', async () => {
  const { read, calls } = recordingReader([]);
  await listHealAttempts(read);

  expect(calls[0]?.values).toEqual([ATTEMPT_LIST_LIMIT]);
});

test('resolveLimit: undefined', () => {
  expect(resolveLimit(undefined)).toBe(ATTEMPT_LIST_LIMIT);
});

test('resolveLimit: zero', () => {
  expect(resolveLimit(0)).toBe(ATTEMPT_LIST_LIMIT);
});

test('resolveLimit: negative', () => {
  expect(resolveLimit(-3)).toBe(ATTEMPT_LIST_LIMIT);
});

test('resolveLimit: non-integer', () => {
  expect(resolveLimit(1.5)).toBe(ATTEMPT_LIST_LIMIT);
});

test('resolveLimit: valid number', () => {
  expect(resolveLimit(10)).toBe(10);
});

test('resolveLimit: capped at max', () => {
  expect(resolveLimit(10_000)).toBe(MAX_ATTEMPT_LIST_LIMIT);
});

test('toHealAttemptListRow: full row mapping', () => {
  const raw = {
    id: 'abc-123',
    test_run_id: 'run-456',
    spec_file: 'specs/foo.spec.ts',
    test_name: 'should work',
    original_selector: '#old',
    proposed_selector: '#new',
    confidence: 'high' as const,
    tool_call_count: 3,
    status: 'healed' as const,
    failure_reason: null,
    pr_url: 'https://github.com/x/y/pull/1',
    created_at: new Date('2025-01-02T03:04:05Z'),
  };

  const result = toHealAttemptListRow(raw);

  expect(result.id).toBe('abc-123');
  expect(result.testRunId).toBe('run-456');
  expect(result.specFile).toBe('specs/foo.spec.ts');
  expect(result.testName).toBe('should work');
  expect(result.originalSelector).toBe('#old');
  expect(result.proposedSelector).toBe('#new');
  expect(result.confidence).toBe('high');
  expect(result.toolCallCount).toBe(3);
  expect(result.status).toBe('healed');
  expect(result.failureReason).toBeNull();
  expect(result.prUrl).toBe('https://github.com/x/y/pull/1');
  expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('toHealAttemptListRow: null fields', () => {
  const raw = {
    id: 'abc-123',
    test_run_id: 'run-456',
    spec_file: 'specs/foo.spec.ts',
    test_name: 'should work',
    original_selector: '#old',
    proposed_selector: null,
    confidence: 'high' as const,
    tool_call_count: 1,
    status: 'failed' as const,
    failure_reason: null,
    pr_url: null,
    created_at: '2025-01-02T03:04:05Z',
  };

  const result = toHealAttemptListRow(raw);

  expect(result.proposedSelector).toBeNull();
  expect(result.failureReason).toBeNull();
  expect(result.prUrl).toBeNull();
});

test('toHealAttemptListRow: invalid status throws', () => {
  const raw = {
    id: 'abc-123',
    test_run_id: 'run-456',
    spec_file: 'specs/foo.spec.ts',
    test_name: 'should work',
    original_selector: '#old',
    proposed_selector: '#new',
    confidence: 'high' as const,
    tool_call_count: 1,
    status: 'merged',
    failure_reason: null,
    pr_url: null,
    created_at: '2025-01-02T03:04:05Z',
  };

  expect(() => toHealAttemptListRow(raw)).toThrow(DashboardDataError);
});

test('toHealAttemptListRow: invalid confidence throws', () => {
  const raw = {
    id: 'abc-123',
    test_run_id: 'run-456',
    spec_file: 'specs/foo.spec.ts',
    test_name: 'should work',
    original_selector: '#old',
    proposed_selector: '#new',
    confidence: 'medium',
    tool_call_count: 1,
    status: 'healed' as const,
    failure_reason: null,
    pr_url: null,
    created_at: '2025-01-02T03:04:05Z',
  };

  expect(() => toHealAttemptListRow(raw)).toThrow(DashboardDataError);
});

test('toHealAttemptListRow: error does not contain row values', () => {
  const distinctSelector = 'unique-selector-xyz-789';
  const raw = {
    id: 'abc-123',
    test_run_id: 'run-456',
    spec_file: 'specs/foo.spec.ts',
    test_name: 'should work',
    original_selector: distinctSelector,
    proposed_selector: '#new',
    confidence: 'high' as const,
    tool_call_count: 1,
    status: 'merged',
    failure_reason: null,
    pr_url: null,
    created_at: '2025-01-02T03:04:05Z',
  };

  let error: Error | null = null;
  try {
    toHealAttemptListRow(raw);
  } catch (e) {
    error = e as Error;
  }

  expect(error).not.toBeNull();
  expect(error!.message).not.toContain(distinctSelector);
});

test('toHealAttemptListRow: transcript not in result', () => {
  const raw = {
    id: 'abc-123',
    test_run_id: 'run-456',
    spec_file: 'specs/foo.spec.ts',
    test_name: 'should work',
    original_selector: '#old',
    proposed_selector: '#new',
    confidence: 'high' as const,
    tool_call_count: 1,
    status: 'healed' as const,
    failure_reason: null,
    pr_url: null,
    created_at: '2025-01-02T03:04:05Z',
  };

  const result = toHealAttemptListRow(raw);

  expect('transcript' in result).toBe(false);
});

test('listHealAttempts: preserves order', async () => {
  const rows = [
    {
      id: 'id-1',
      test_run_id: 'run',
      spec_file: 'spec',
      test_name: 'test',
      original_selector: '#a',
      proposed_selector: null,
      confidence: 'high' as const,
      tool_call_count: 1,
      status: 'healed' as const,
      failure_reason: null,
      pr_url: null,
      created_at: '2025-01-03T00:00:00Z',
    },
    {
      id: 'id-2',
      test_run_id: 'run',
      spec_file: 'spec',
      test_name: 'test',
      original_selector: '#b',
      proposed_selector: null,
      confidence: 'high' as const,
      tool_call_count: 1,
      status: 'healed' as const,
      failure_reason: null,
      pr_url: null,
      created_at: '2025-01-02T00:00:00Z',
    },
    {
      id: 'id-3',
      test_run_id: 'run',
      spec_file: 'spec',
      test_name: 'test',
      original_selector: '#c',
      proposed_selector: null,
      confidence: 'high' as const,
      tool_call_count: 1,
      status: 'healed' as const,
      failure_reason: null,
      pr_url: null,
      created_at: '2025-01-01T00:00:00Z',
    },
  ];

  const { read } = recordingReader(rows);
  const result = await listHealAttempts(read);

  expect(result.map((r) => r.id)).toEqual(['id-1', 'id-2', 'id-3']);
});

test('summariseAttempts: empty', () => {
  const summary = summariseAttempts([]);

  expect(summary.total).toBe(0);
  expect(summary.byStatus.investigating).toBe(0);
  expect(summary.byStatus.healed).toBe(0);
  expect(summary.byStatus.needs_review).toBe(0);
  expect(summary.byStatus.failed).toBe(0);
  expect(summary.byConfidence.high).toBe(0);
  expect(summary.byConfidence.low).toBe(0);
  expect(summary.byConfidence.none).toBe(0);
  expect(summary.withPr).toBe(0);
});

test('summariseAttempts: counts correctly', () => {
  const rows = [
    {
      id: '1',
      testRunId: 'run',
      specFile: 'spec',
      testName: 'test',
      originalSelector: '#a',
      proposedSelector: null,
      confidence: 'high' as const,
      toolCallCount: 1,
      status: 'healed' as const,
      failureReason: null,
      prUrl: 'https://github.com/x/y/pull/1',
      createdAt: '2025-01-01',
    },
    {
      id: '2',
      testRunId: 'run',
      specFile: 'spec',
      testName: 'test',
      originalSelector: '#b',
      proposedSelector: null,
      confidence: 'low' as const,
      toolCallCount: 1,
      status: 'failed' as const,
      failureReason: null,
      prUrl: null,
      createdAt: '2025-01-02',
    },
    {
      id: '3',
      testRunId: 'run',
      specFile: 'spec',
      testName: 'test',
      originalSelector: '#c',
      proposedSelector: null,
      confidence: 'none' as const,
      toolCallCount: 1,
      status: 'needs_review' as const,
      failureReason: null,
      prUrl: null,
      createdAt: '2025-01-03',
    },
    {
      id: '4',
      testRunId: 'run',
      specFile: 'spec',
      testName: 'test',
      originalSelector: '#d',
      proposedSelector: null,
      confidence: 'high' as const,
      toolCallCount: 1,
      status: 'investigating' as const,
      failureReason: null,
      prUrl: null,
      createdAt: '2025-01-04',
    },
  ];

  const summary = summariseAttempts(rows);

  expect(summary.total).toBe(4);
  expect(summary.byStatus.healed).toBe(1);
  expect(summary.byStatus.failed).toBe(1);
  expect(summary.byStatus.needs_review).toBe(1);
  expect(summary.byStatus.investigating).toBe(1);
  expect(summary.byConfidence.high).toBe(2);
  expect(summary.byConfidence.low).toBe(1);
  expect(summary.byConfidence.none).toBe(1);
  expect(summary.withPr).toBe(1);
});

test('summariseAttempts: only expected keys', () => {
  const summary = summariseAttempts([]);

  expect(Object.keys(summary).sort()).toEqual(['byConfidence', 'byStatus', 'total', 'withPr']);
});

test('loadAttempts: no reader', async () => {
  const result = await loadAttempts(null);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('no-database-url');
  }
});

test('loadAttempts: reader rejects', async () => {
  const failingReader: RowReader = async () => {
    throw new Error('… postgres://u:p@h/db …');
  };

  const result = await loadAttempts(failingReader);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('query-failed');
    expect(result.message).not.toContain('u:p');
  }
});

test('loadAttempts: truncated when at limit', async () => {
  const rows = Array.from({ length: ATTEMPT_LIST_LIMIT }, (_, i) => ({
    id: `id-${i}`,
    test_run_id: 'run',
    spec_file: 'spec',
    test_name: 'test',
    original_selector: '#a',
    proposed_selector: null,
    confidence: 'high' as const,
    tool_call_count: 1,
    status: 'healed' as const,
    failure_reason: null,
    pr_url: null,
    created_at: '2025-01-01',
  }));

  const { read } = recordingReader(rows);
  const result = await loadAttempts(read);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.truncated).toBe(true);
    expect(result.limit).toBe(ATTEMPT_LIST_LIMIT);
  }
});

test('loadAttempts: not truncated when below limit', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    id: `id-${i}`,
    test_run_id: 'run',
    spec_file: 'spec',
    test_name: 'test',
    original_selector: '#a',
    proposed_selector: null,
    confidence: 'high' as const,
    tool_call_count: 1,
    status: 'healed' as const,
    failure_reason: null,
    pr_url: null,
    created_at: '2025-01-01',
  }));

  const { read } = recordingReader(rows);
  const result = await loadAttempts(read);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.truncated).toBe(false);
  }
});

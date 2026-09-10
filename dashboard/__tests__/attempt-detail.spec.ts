import { test, expect } from '@playwright/test';
import {
  DETAIL_ATTEMPT_SQL,
  ATTEMPT_ID_PATTERN,
  isAttemptId,
  toHealAttemptDetailRow,
  loadAttemptDetail,
} from '../lib/attempt-detail';
import type { RowReader } from '../lib/attempts';

function recordingReader(rows: readonly Record<string, unknown>[]) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const read: RowReader = async (text, values) => {
    calls.push({ text, values });
    return rows;
  };
  return { read, calls };
}

const validId = '550e8400-e29b-41d4-a716-446655440000';

test('DETAIL_ATTEMPT_SQL: is read-only', () => {
  expect(DETAIL_ATTEMPT_SQL).toMatch(/^\s*SELECT\b/i);
});

test('DETAIL_ATTEMPT_SQL: no write verbs', () => {
  expect(DETAIL_ATTEMPT_SQL).not.toMatch(
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i
  );
});

test('DETAIL_ATTEMPT_SQL: contains transcript', () => {
  expect(DETAIL_ATTEMPT_SQL).toContain('transcript');
});

test('DETAIL_ATTEMPT_SQL: single row with LIMIT 1', () => {
  expect(DETAIL_ATTEMPT_SQL).toContain('WHERE id = $1');
  expect(DETAIL_ATTEMPT_SQL).toContain('LIMIT 1');
});

test('DETAIL_ATTEMPT_SQL: exactly one parameter', () => {
  const matches = DETAIL_ATTEMPT_SQL.match(/\$\d+/g) ?? [];
  expect(matches).toEqual(['$1']);
});

test('DETAIL_ATTEMPT_SQL: from heal_attempts', () => {
  expect(DETAIL_ATTEMPT_SQL).toContain('FROM heal_attempts');
});

test('isAttemptId: valid UUID', () => {
  expect(isAttemptId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
});

test('isAttemptId: invalid formats', () => {
  expect(isAttemptId('nope')).toBe(false);
  expect(isAttemptId('')).toBe(false);
  expect(isAttemptId('550e8400-e29b-41d4-a716-446655440000 ')).toBe(false);
  expect(isAttemptId('1; DROP TABLE heal_attempts')).toBe(false);
});

test('ATTEMPT_ID_PATTERN is stateless', () => {
  // Multiple calls should have consistent results
  expect(ATTEMPT_ID_PATTERN.test(validId)).toBe(true);
  expect(ATTEMPT_ID_PATTERN.test(validId)).toBe(true);
});

test('loadAttemptDetail: no reader', async () => {
  const result = await loadAttemptDetail(null, validId);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('no-database-url');
  }
});

test('loadAttemptDetail: invalid id never queries', async () => {
  const { read, calls } = recordingReader([]);
  const result = await loadAttemptDetail(read, 'not-a-uuid');
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('invalid-id');
  }
  expect(calls.length).toBe(0);
});

test('loadAttemptDetail: reader returning empty', async () => {
  const { read, calls } = recordingReader([]);
  const result = await loadAttemptDetail(read, validId);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('not-found');
  }
  expect(calls.length).toBe(1);
  expect(calls[0]?.values).toEqual([validId]);
});

test('loadAttemptDetail: successful load', async () => {
  const row = {
    id: validId,
    test_run_id: 'run-123',
    spec_file: 'test.spec.ts',
    test_name: 'should work',
    original_selector: '#old',
    proposed_selector: '#new',
    confidence: 'high' as const,
    tool_call_count: 2,
    status: 'healed' as const,
    failure_reason: null,
    pr_url: null,
    transcript: { schemaVersion: 1, transcript: {} },
    created_at: new Date('2025-01-01T00:00:00Z'),
  };

  const { read } = recordingReader([row]);
  const result = await loadAttemptDetail(read, validId);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.row.id).toBe(validId);
    expect(result.row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(result.transcript.kind).toBe('envelope');
  }
});

test('loadAttemptDetail: no transcript key', async () => {
  const row = {
    id: validId,
    test_run_id: 'run-123',
    spec_file: 'test.spec.ts',
    test_name: 'should work',
    original_selector: '#old',
    proposed_selector: null,
    confidence: 'none' as const,
    tool_call_count: 0,
    status: 'investigating' as const,
    failure_reason: null,
    pr_url: null,
    created_at: '2025-01-01T00:00:00Z',
  };

  const { read } = recordingReader([row]);
  const result = await loadAttemptDetail(read, validId);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.row.transcript).toBeNull();
    expect(result.transcript.kind).toBe('absent');
  }
});

test('loadAttemptDetail: empty transcript object', async () => {
  const row = {
    id: validId,
    test_run_id: 'run-123',
    spec_file: 'test.spec.ts',
    test_name: 'should work',
    original_selector: '#old',
    proposed_selector: null,
    confidence: 'none' as const,
    tool_call_count: 0,
    status: 'investigating' as const,
    failure_reason: null,
    pr_url: null,
    transcript: {},
    created_at: '2025-01-01T00:00:00Z',
  };

  const { read } = recordingReader([row]);
  const result = await loadAttemptDetail(read, validId);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.transcript.kind).toBe('absent');
  }
});

test('loadAttemptDetail: reader rejection', async () => {
  const failingReader: RowReader = async () => {
    throw new Error('connect ECONNREFUSED postgres://alice:hunter2@db:5432/mend');
  };

  const result = await loadAttemptDetail(failingReader, validId);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('query-failed');
    expect(result.message).not.toContain('hunter2');
    expect(result.message).not.toContain('alice');
  }
});

test('loadAttemptDetail: invalid status throws from mapper', async () => {
  const row = {
    id: validId,
    test_run_id: 'run-123',
    spec_file: 'test.spec.ts',
    test_name: 'should work',
    original_selector: '#old',
    proposed_selector: null,
    confidence: 'high' as const,
    tool_call_count: 0,
    status: 'merged',
    failure_reason: null,
    pr_url: null,
    transcript: null,
    created_at: '2025-01-01T00:00:00Z',
  };

  const { read } = recordingReader([row]);
  const result = await loadAttemptDetail(read, validId);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('query-failed');
  }
});

test('loadAttemptDetail: single query only', async () => {
  const { read, calls } = recordingReader([]);
  await loadAttemptDetail(read, validId);

  expect(calls.length).toBe(1);
});

test('loadAttemptDetail: attemptId always present', async () => {
  const { read } = recordingReader([]);
  const result = await loadAttemptDetail(read, 'my-test-id');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.attemptId).toBe('my-test-id');
  }
});

test('toHealAttemptDetailRow: adds transcript', () => {
  const raw = {
    id: 'id-123',
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
    transcript: { key: 'value' },
  };

  const result = toHealAttemptDetailRow(raw);

  expect(result.id).toBe('id-123');
  expect(result.transcript).toEqual({ key: 'value' });
});

import { test, expect } from '@playwright/test';
import {
  classifyConnectionError,
  describeError,
  formatConnectionFailure,
  parseConnectionTarget,
  UNREACHABLE_HEADLINE,
} from '../connection-errors.js';

test('classifyConnectionError: ECONNREFUSED → server-unreachable', () => {
  const error = new Error('connect ECONNREFUSED 127.0.0.1:5432');
  (error as unknown as Record<string, unknown>).code = 'ECONNREFUSED';

  const diagnosis = classifyConnectionError(error, 'postgres://user:pass@127.0.0.1:5432/db');
  expect(diagnosis.kind).toBe('server-unreachable');
  expect(diagnosis.headline).toBe(UNREACHABLE_HEADLINE);
});

test('classifyConnectionError: AggregateError with empty message', () => {
  const aggregateError = {
    message: '',
    errors: [
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED ::1:1' },
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:1' },
    ],
  };

  const diagnosis = classifyConnectionError(aggregateError, 'postgres://user:pass@127.0.0.1:5432/db');
  expect(diagnosis.kind).toBe('server-unreachable');
  expect(describeError(aggregateError).trim().length).toBeGreaterThan(0);
});

test('classifyConnectionError: database missing (code 3D000)', () => {
  const error = { code: '3D000', message: 'database "mend" does not exist' };
  const diagnosis = classifyConnectionError(error, 'postgres://user:pass@127.0.0.1:5432/mend_nope');
  expect(diagnosis.kind).toBe('database-missing');
  expect(diagnosis.headline).toContain('mend_nope');
  expect(diagnosis.headline).toContain('does not exist');
});

test('classifyConnectionError: authentication failed (code 28P01)', () => {
  const error = { code: '28P01', message: 'password authentication failed for user "mend_user"' };
  const diagnosis = classifyConnectionError(error, 'postgres://mend_user:pass@127.0.0.1:5432/db');
  expect(diagnosis.kind).toBe('authentication-failed');
  expect(diagnosis.headline).toContain('mend_user');
});

test('classifyConnectionError: host not found (code ENOTFOUND)', () => {
  const error = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND invalid.host' };
  const diagnosis = classifyConnectionError(error, 'postgres://user:pass@invalid.host:5432/db');
  expect(diagnosis.kind).toBe('host-not-found');
  expect(diagnosis.headline).toContain('invalid.host');
});

test('classifyConnectionError: unknown error', () => {
  const error = {};
  const diagnosis = classifyConnectionError(error, 'postgres://user:pass@127.0.0.1:5432/db');
  expect(diagnosis.kind).toBe('unknown');
  expect(describeError(error).trim().length).toBeGreaterThan(0);
});

test('describeError: returns non-empty string for undefined', () => {
  const result = describeError(undefined);
  expect(result.trim().length).toBeGreaterThan(0);
});

test('describeError: returns non-empty string for null', () => {
  const result = describeError(null);
  expect(result.trim().length).toBeGreaterThan(0);
});

test('describeError: returns non-empty string for empty string', () => {
  const result = describeError('');
  expect(result.trim().length).toBeGreaterThan(0);
});

test('describeError: returns non-empty string for zero', () => {
  const result = describeError(0);
  expect(result.trim().length).toBeGreaterThan(0);
});

test('describeError: returns non-empty string for empty Error', () => {
  const result = describeError(new Error(''));
  expect(result.trim().length).toBeGreaterThan(0);
});

test('describeError: returns non-empty string for AggregateError with empty message', () => {
  const aggregateError = {
    message: '',
    errors: [
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED ::1:1' },
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:1' },
    ],
  };
  const result = describeError(aggregateError);
  expect(result.trim().length).toBeGreaterThan(0);
});

test('parseConnectionTarget: parses valid postgres URL', () => {
  const target = parseConnectionTarget('postgres://mend_user:sup3rs3cret@127.0.0.1:1/mend_nope');
  expect(target.host).toBe('127.0.0.1');
  expect(target.port).toBe('1');
  expect(target.database).toBe('mend_nope');
  expect(target.user).toBe('mend_user');
  expect(target.parsed).toBe(true);
});

test('parseConnectionTarget: returns parsed: false for invalid URL', () => {
  const target = parseConnectionTarget('host=localhost dbname=mend');
  expect(target.parsed).toBe(false);
});

test('formatConnectionFailure: never contains password', () => {
  const error = { code: 'ECONNREFUSED' };
  const diagnosis = classifyConnectionError(error, 'postgres://user:sup3rs3cret@127.0.0.1:1/db');
  const output = formatConnectionFailure(diagnosis);
  expect(output).not.toContain('sup3rs3cret');
});

test('formatConnectionFailure: has 4 lines with proper structure', () => {
  const error = { code: 'ECONNREFUSED' };
  const diagnosis = classifyConnectionError(error, 'postgres://user:pass@127.0.0.1:1/db');
  const output = formatConnectionFailure(diagnosis);
  const lines = output.split('\n');
  expect(lines.length).toBe(4);
  expect(lines[0]).toBe(UNREACHABLE_HEADLINE);
  expect(lines[1]).toMatch(/^  target: /);
  expect(lines[2]).toMatch(/^  cause:  /);
  expect(lines[3]).toMatch(/^Hint: /);
});

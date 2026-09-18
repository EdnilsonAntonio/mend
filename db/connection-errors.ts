import { MigrationError } from './migration-files.js';

export type ConnectionFailureKind =
  | 'server-unreachable'
  | 'host-not-found'
  | 'database-missing'
  | 'authentication-failed'
  | 'unknown';

/** Pinned by spec/TASKS.md Task 8.1. Do not reword. */
export const UNREACHABLE_HEADLINE =
  'Could not reach DATABASE_URL — is Postgres running and is the database created?';

export const CONNECTION_FAILURE_HINTS: Record<ConnectionFailureKind, string> = {
  'server-unreachable':
    'Hint: start Postgres and check the host and port in DATABASE_URL. db/README.md has a ready-to-run Docker command.',
  'host-not-found':
    'Hint: check the hostname in DATABASE_URL for a typo, and that it resolves from this machine.',
  'database-missing':
    "Hint: create it with `createdb <name>` (or `psql -c 'CREATE DATABASE <name>'`), then re-run `npm run db:migrate`.",
  'authentication-failed':
    'Hint: check the user and password in DATABASE_URL against the server\'s credentials.',
  unknown:
    'Hint: check DATABASE_URL, then see db/README.md for the expected connection-string format.',
};

/** Host/port/database/user parsed from a connection string. Never holds the password. */
export interface ConnectionTarget {
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly user: string;
  /** False when the connection string is not a parsable URL. */
  readonly parsed: boolean;
}

export interface ConnectionDiagnosis {
  readonly kind: ConnectionFailureKind;
  /** First printed line. Specific to the kind. */
  readonly headline: string;
  /** Non-empty description of the underlying error. Never the empty string. */
  readonly cause: string;
  /** One-line actionable next step. */
  readonly hint: string;
  readonly target: ConnectionTarget;
}

export function parseConnectionTarget(connectionString: string): ConnectionTarget {
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname || '(unset)',
      port: url.port || '5432',
      database: decodeURIComponent(url.pathname.replace(/^\//, '')) || '(unset)',
      user: decodeURIComponent(url.username) || '(unset)',
      parsed: true,
    };
  } catch {
    return {
      host: '(unparsed)',
      port: '(unparsed)',
      database: '(unparsed)',
      user: '(unparsed)',
      parsed: false,
    };
  }
}

/** e.g. `host=127.0.0.1 port=1 database=mend_nope user=mend_user`. Never includes a password. */
export function describeConnectionTarget(target: ConnectionTarget): string {
  if (!target.parsed) {
    return 'DATABASE_URL could not be parsed as a postgres:// URL';
  }
  return `host=${target.host} port=${target.port} database=${target.database} user=${target.user}`;
}

/** All string `code` values found on the error, its `errors[]`, and its `cause` chain. */
export function collectErrorCodes(error: unknown): readonly string[] {
  const codes: string[] = [];
  const visited = new Set<unknown>();
  let depth = 0;

  function walk(node: unknown) {
    if (visited.size >= 32 || depth >= 5) {
      return;
    }

    visited.add(node);
    depth++;

    if (
      node !== null &&
      typeof node === 'object'
    ) {
      const obj = node as unknown as Record<string, unknown>;

      // Check for code property
      if (typeof obj.code === 'string' && obj.code.length > 0) {
        codes.push(obj.code);
      }

      // Walk errors array (breadth-first)
      if (Array.isArray(obj.errors)) {
        for (const err of obj.errors) {
          if (!visited.has(err)) {
            walk(err);
          }
        }
      }

      // Walk cause chain
      if (obj.cause !== null && typeof obj.cause === 'object' && !visited.has(obj.cause)) {
        walk(obj.cause);
      }
    }

    depth--;
  }

  walk(error);
  return codes;
}

/** Always returns a non-empty string, for any input including `undefined` and `AggregateError`. */
export function describeError(error: unknown): string {
  function describeErrorInternal(err: unknown, depth: number): string {
    // Bounded recursion
    if (depth > 3) {
      return 'error (max recursion depth reached)';
    }

    // Check for non-empty message first
    if (
      err !== null &&
      typeof err === 'object' &&
      typeof (err as unknown as Record<string, unknown>).message === 'string'
    ) {
      const msg = (err as unknown as Record<string, unknown>).message as string;
      if (msg.trim().length > 0) {
        return msg;
      }
    }

    // Check for errors array
    if (
      err !== null &&
      typeof err === 'object' &&
      Array.isArray((err as unknown as Record<string, unknown>).errors)
    ) {
      const errors = (err as unknown as Record<string, unknown>).errors as unknown[];
      const descriptions = new Set<string>();
      for (const childErr of errors) {
        const desc = describeErrorInternal(childErr, depth + 1);
        descriptions.add(desc);
      }
      if (descriptions.size > 0) {
        const result = Array.from(descriptions).join('; ');
        if (result.length > 0) {
          return result;
        }
      }
    }

    // Check for code property
    if (
      err !== null &&
      typeof err === 'object' &&
      typeof (err as unknown as Record<string, unknown>).code === 'string'
    ) {
      const code = (err as unknown as Record<string, unknown>).code as string;
      if (code.length > 0) {
        return code;
      }
    }

    // Try String(error)
    const str = String(err);
    if (str.length > 0 && str !== '[object Object]') {
      return str;
    }

    // Fall back to constructor name
    if (
      err !== null &&
      typeof err === 'object' &&
      (err as unknown as Record<string, unknown>).constructor !== null &&
      typeof (err as unknown as Record<string, unknown>).constructor === 'object'
    ) {
      const ctor = (err as unknown as Record<string, unknown>).constructor as unknown as Record<string, unknown>;
      if (typeof ctor.name === 'string' && ctor.name.length > 0) {
        return ctor.name;
      }
    }

    return 'unknown error';
  }

  return describeErrorInternal(error, 0);
}

export function classifyConnectionError(
  error: unknown,
  connectionString: string,
): ConnectionDiagnosis {
  const target = parseConnectionTarget(connectionString);
  const codes = collectErrorCodes(error);
  const cause = describeError(error);

  // Determine kind by matching rules in exact order
  let kind: ConnectionFailureKind = 'unknown';

  // Rule 1: database missing (code 3D000)
  if (codes.includes('3D000')) {
    kind = 'database-missing';
  }
  // Rule 2: authentication failed (codes 28P01, 28000, 28P02)
  else if (codes.some(c => c === '28P01' || c === '28000' || c === '28P02')) {
    kind = 'authentication-failed';
  }
  // Rule 3: host not found (codes ENOTFOUND, EAI_AGAIN)
  else if (codes.some(c => c === 'ENOTFOUND' || c === 'EAI_AGAIN')) {
    kind = 'host-not-found';
  }
  // Rule 4: server unreachable (codes ECONNREFUSED, ECONNRESET, EHOSTUNREACH, ENETUNREACH, ETIMEDOUT, EPIPE, ERR_SOCKET_CONNECTION_TIMEOUT)
  else if (codes.some(c => c === 'ECONNREFUSED' || c === 'ECONNRESET' || c === 'EHOSTUNREACH' || c === 'ENETUNREACH' || c === 'ETIMEDOUT' || c === 'EPIPE' || c === 'ERR_SOCKET_CONNECTION_TIMEOUT')) {
    kind = 'server-unreachable';
  }
  // Rule 5: database missing (by message pattern)
  else if (/database .* does not exist/i.test(cause)) {
    kind = 'database-missing';
  }
  // Rule 6: authentication failed (by message pattern)
  else if (/password authentication failed|no pg_hba\.conf entry/i.test(cause)) {
    kind = 'authentication-failed';
  }
  // Rule 7: server unreachable (by message pattern)
  else if (/(connect|connection).*(timeout|timed out)|timeout.*connect/i.test(cause)) {
    kind = 'server-unreachable';
  }

  // Generate headline
  let headline: string;
  switch (kind) {
    case 'server-unreachable':
      headline = UNREACHABLE_HEADLINE;
      break;
    case 'database-missing':
      headline = `Reached the Postgres server, but database "${target.database}" does not exist.`;
      break;
    case 'host-not-found':
      headline = `Could not resolve the database host "${target.host}" from DATABASE_URL.`;
      break;
    case 'authentication-failed':
      headline = `Reached the Postgres server, but authentication failed for user "${target.user}".`;
      break;
    case 'unknown':
      headline = 'Could not connect to the database in DATABASE_URL.';
      break;
  }

  const hint = CONNECTION_FAILURE_HINTS[kind];

  return {
    kind,
    headline,
    cause,
    hint,
    target,
  };
}

export function formatConnectionFailure(diagnosis: ConnectionDiagnosis): string {
  // Collapse newlines in cause
  const collapsedCause = diagnosis.cause.replace(/\s*\n\s*/g, ' ');
  const targetDesc = describeConnectionTarget(diagnosis.target);
  const lines = [
    diagnosis.headline,
    `  target: ${targetDesc}`,
    `  cause:  ${collapsedCause}`,
    diagnosis.hint,
  ];
  return lines.join('\n');
}

export class DatabaseConnectionError extends MigrationError {
  readonly diagnosis: ConnectionDiagnosis;

  constructor(diagnosis: ConnectionDiagnosis, options?: { cause?: unknown }) {
    super('connection-failed', formatConnectionFailure(diagnosis), options);
    this.name = 'DatabaseConnectionError';
    this.diagnosis = diagnosis;
  }
}

export const MAX_CANDIDATE_SELECTOR_LENGTH = 200;
export const FORBIDDEN_SELECTOR_SUBSTRINGS: readonly string[] = ['\n', '\r', '\\', '`', '${'];

export type SubstitutionFailure =
  | 'unsafe-candidate-selector'
  | 'candidate-identical-to-original'
  | 'selector-not-found'
  | 'selector-ambiguous';

export interface SubstitutionResult {
  /** True only when exactly one literal was replaced. */
  readonly ok: boolean;
  /** The full proposed spec source. null whenever `ok` is false. */
  readonly proposedSource: string | null;
  /** The exact source text replaced, including its quote characters, e.g. `'#login-btn'`. */
  readonly fromLiteral: string | null;
  /** The exact source text inserted, including its quote characters. */
  readonly toLiteral: string | null;
  /** Occurrences of the original selector literal across all three quote forms. */
  readonly occurrences: number;
  /** null when `ok` is true. */
  readonly failure: SubstitutionFailure | null;
  /** Human-readable explanation. Empty string when `ok` is true. */
  readonly detail: string;
}

/** Every string literal in source order, including its delimiters. */
export function extractStringLiterals(source: string): readonly string[] {
  const STRING_LITERAL_PATTERN =
    /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  const matches = source.match(STRING_LITERAL_PATTERN);
  return matches ?? [];
}

export function applySelectorSubstitution(
  originalSource: string,
  originalSelector: string,
  candidateSelector: string,
): SubstitutionResult {
  // 1. Candidate safety checks
  if (candidateSelector.trim().length === 0) {
    return {
      ok: false,
      proposedSource: null,
      fromLiteral: null,
      toLiteral: null,
      occurrences: 0,
      failure: 'unsafe-candidate-selector',
      detail: 'candidate selector must be a non-empty string',
    };
  }

  if (candidateSelector.length > MAX_CANDIDATE_SELECTOR_LENGTH) {
    return {
      ok: false,
      proposedSource: null,
      fromLiteral: null,
      toLiteral: null,
      occurrences: 0,
      failure: 'unsafe-candidate-selector',
      detail: `candidate selector exceeds ${MAX_CANDIDATE_SELECTOR_LENGTH} characters`,
    };
  }

  for (const forbidden of FORBIDDEN_SELECTOR_SUBSTRINGS) {
    if (candidateSelector.includes(forbidden)) {
      return {
        ok: false,
        proposedSource: null,
        fromLiteral: null,
        toLiteral: null,
        occurrences: 0,
        failure: 'unsafe-candidate-selector',
        detail: `candidate selector contains a forbidden substring: ${JSON.stringify(forbidden)}`,
      };
    }
  }

  if (candidateSelector === originalSelector) {
    return {
      ok: false,
      proposedSource: null,
      fromLiteral: null,
      toLiteral: null,
      occurrences: 0,
      failure: 'candidate-identical-to-original',
      detail: 'candidate selector is identical to the original selector',
    };
  }

  // 2. Quote choice
  let quote: string | null;
  if (!candidateSelector.includes("'")) {
    quote = "'";
  } else if (!candidateSelector.includes('"')) {
    quote = '"';
  } else {
    quote = null;
  }

  if (quote === null) {
    return {
      ok: false,
      proposedSource: null,
      fromLiteral: null,
      toLiteral: null,
      occurrences: 0,
      failure: 'unsafe-candidate-selector',
      detail: 'candidate selector contains both quote characters',
    };
  }

  // 3. Locate the original literal
  let occurrences = 0;
  let foundForm: string | null = null;

  for (const q of ["'", '"', '`']) {
    const literal = q + originalSelector + q;
    let count = 0;
    let searchStart = 0;

    while (true) {
      const idx = originalSource.indexOf(literal, searchStart);
      if (idx === -1) break;
      count++;
      searchStart = idx + literal.length;
    }

    occurrences += count;
    if (count > 0) {
      foundForm = literal;
    }
  }

  if (occurrences === 0) {
    return {
      ok: false,
      proposedSource: null,
      fromLiteral: null,
      toLiteral: null,
      occurrences: 0,
      failure: 'selector-not-found',
      detail: 'original selector literal not found in spec source',
    };
  }

  if (occurrences > 1) {
    return {
      ok: false,
      proposedSource: null,
      fromLiteral: null,
      toLiteral: null,
      occurrences,
      failure: 'selector-ambiguous',
      detail: `original selector literal occurs ${occurrences} times; exactly one is required`,
    };
  }

  // 4. Substitute
  // At this point, foundForm is not null and occurs exactly once
  const fromLiteral = foundForm!;
  const toLiteral = quote + candidateSelector + quote;

  const idx = originalSource.indexOf(fromLiteral);
  const proposedSource =
    originalSource.slice(0, idx) + toLiteral + originalSource.slice(idx + fromLiteral.length);

  // 5. Return success
  return {
    ok: true,
    proposedSource,
    fromLiteral,
    toLiteral,
    occurrences: 1,
    failure: null,
    detail: '',
  };
}

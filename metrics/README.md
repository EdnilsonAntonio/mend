# Metrics

Read-only reporting over persisted heal-attempt data. The metrics command produces four evidence numbers with their denominators from already-executed test runs and heal attempts stored in PostgreSQL.

## Command

```bash
npm run metrics
```

Or with flags:

```bash
npm run metrics -- [--run=<uuid>] [--since=<iso8601>] [--json]
```

Flags:
- `--run=<uuid>` — Restrict to a specific test run (UUID format).
- `--since=<iso8601>` — Restrict to attempts created at or after this ISO 8601 timestamp.
- `--json` — Emit JSON instead of human-readable text.

## Prerequisites

- PostgreSQL must be set up via `npm run db:migrate`
- At least one healing run must be complete via `npm run heal`
- `DATABASE_URL` environment variable must be set

## Metric definitions

**Heal rate**: The proportion of settled (non-investigating) attempts that reached `healed` status. Numerator: `status === 'healed'`. Denominator: all settled attempts.

**Verified fix rate**: The proportion of settled attempts that produced a verified fix — either `healed` or `needs_review` (a PR that is pending human merge). Numerator: `healed + needs_review`. Denominator: all settled attempts. This is higher than the heal rate because a PR-delivery failure is still a verified fix that may be merged.

**Average tool calls**: The mean number of tool calls (API interactions) per attempt, reported separately for all settled attempts, for the healed subset, and for the verified-fix subset.

**Cost per heal**: The total USD cost of all settled attempts (including failed ones) divided by the count of successful heals. This reflects the practical cost to produce one successful selector fix, accounting for failed attempts. Tokens are read from stored transcripts; prices come from the `MODEL_PRICING` table with a configurable `source` string for each model.

**False-fix rate**: The proportion of settled attempts with a `proposed_selector` that violate one or more audit rules. This is an audit of the persisted data, not a re-execution of the agent. See the False-Fix Audit section below.

## The false-fix audit

The `metrics` command examines every settled attempt with a non-null `proposed_selector` and checks it against ten rules derived from the project's invariants. If any rule fires, the attempt is marked as a false fix. The command exits with code 5 if any false fixes are detected; exit code 0 means zero false fixes.

Audit codes:

| Code | Fires when |
| --- | --- |
| `fix-without-verification` | The proposed selector was accepted but the transcript has no verification object |
| `fix-without-passing-verification` | The verification object is present but `passed !== true` |
| `fix-without-matching-passing-run` | No `run_single_test` tool call matches the proposed selector with `passed=true` and `executed=true` |
| `fix-with-integrity-violation` | A `run_single_test` matching the proposed selector has `rejected !== null` or `violationCount > 0` |
| `transcript-selector-mismatch` | The row's `proposed_selector` differs from `transcript.proposedSelector` |
| `healed-without-high-transcript-confidence` | Status is `healed` but `transcript.confidence !== 'high'` |
| `pr-url-without-healed-high` | A PR URL is set but status is not `healed` or confidence is not `high` |
| `tool-call-cap-exceeded` | Tool call count exceeds the hard cap of 5 |
| `status-confidence-mismatch` | The `(status, confidence)` pair is not one of `(healed, high)`, `(needs_review, low)`, or `(failed, none)` |
| `fix-for-unfixable-scenario` | The spec file matches a seeded demo scenario with `requiredOutcome === 'no-fix'` |

### What this number does not prove

The false-fix audit verifies that **execution evidence** exists in the transcript for every accepted fix — i.e. that the fix was actually tested and passed, and that no assertion was weakened. For the seeded demo spec files (scenarios 1–5), it also cross-checks against ground truth: a fix for a scenario marked `no-fix` is unambiguously false.

**The audit does not establish semantic correctness.** It does not verify that a proposed selector targets the same element that the test originally intended to target. Semantic correctness would require storing human labels or re-checking against a live browser, neither of which this tool does. In a real repository with custom spec files, a fix that passes this audit may still target the wrong element; the seeded scenarios are the only cases where semantic truth is stored and checked.

## Cost

Token usage (`promptTokens` and `completionTokens`) is recorded in each stored transcript from OpenAI API responses. The `metrics` command reads these stored tokens and multiplies them by prices from the checked-in `MODEL_PRICING` table in `metrics/pricing.ts`. Each price entry carries a `source` string indicating where and when the price was sourced.

**Cost per heal divides the total cost of all settled attempts by the count of healed attempts.** This includes the cost of failed attempts: a heal that required five tool calls (five model round trips) costs more than one that succeeded on the first call. The cost figures are null when there are no settled attempts with successfully priced models; costPerHealedUsd is additionally null when there are no healed attempts.

**Coverage is always labelled.** When any settled attempt lacks token usage or uses an unpriced model, the output contains `[PARTIAL]` and the cost figure reflects only the attempts for which pricing is available. Use `unpricedModels` to investigate which models were not priced.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | OK; zero false fixes detected |
| 1 | Environment or query error (e.g., DATABASE_URL not set, PostgreSQL unreachable) |
| 2 | Usage error (e.g., invalid UUID or ISO 8601 format) |
| 5 | One or more false fixes detected in the audit |

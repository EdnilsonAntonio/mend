# Database

PostgreSQL schema and migrations for the Self-Healing E2E Tests project.

## Getting a database

For local development, run a PostgreSQL 16 container:

```bash
docker run --rm -d --name mend-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=mend \
  -e POSTGRES_DB=mend \
  postgres:16
```

Then export the connection string:

```bash
export DATABASE_URL=postgres://postgres:mend@localhost:5433/mend
```

For integration tests, use the same instance and also export:

```bash
export MEND_TEST_DATABASE_URL=postgres://postgres:mend@localhost:5433/mend
```

## Commands

### Apply migrations

```bash
npm run db:migrate
```

Applies all pending migrations to the configured schema. Requires `DATABASE_URL` to be set.

**Exit codes:**
- `0` — success (applied 0 or more migrations)
- `1` — migration error (semantic or network issue)
- `2` — usage error (invalid arguments)

### Check migration status

```bash
npm run db:migrate:status
```

Reports which migrations are applied and which are pending, without making changes. Requires `DATABASE_URL`.

**Exit codes:** same as above.

### Run database tests

```bash
npm run test:db
```

Runs the database test suite against `MEND_TEST_DATABASE_URL`. If `MEND_TEST_DATABASE_URL` is unset, the integration tests skip with a message.

### Heal selector-drift failures and persist to database

```bash
npm run heal
```

Reads `test-results/results.json`, classifies failures, runs the heal agent on selector-drift failures, and persists the results to PostgreSQL. Requires `DATABASE_URL` and `OPENAI_API_KEY`. See `runner/README.md` for full documentation.

**Exit codes:**
- `0` — success (attempts may be `failed` if no fix found)
- `1` — error (environment or database)
- `2` — usage error
- `3` — one or more attempts stranded (`status = 'investigating'`); takes precedence over `4`
- `4` — one or more PR deliveries failed; attempts are persisted as `needs_review` with fixes intact

### Run runner tests

```bash
npm run test:runner
```

Runs the runner integration test suite against `MEND_TEST_DATABASE_URL`. If `MEND_TEST_DATABASE_URL` is unset, the integration tests skip with a message.

## Environment variables

### `DATABASE_URL` (required by CLI)

PostgreSQL connection string for applying migrations. Example:

```
postgres://postgres:mend@localhost:5433/mend
```

The connection string is never logged or printed.

### `MEND_TEST_DATABASE_URL` (optional)

PostgreSQL connection string for integration tests. When unset, the integration suite skips. Uses the same format as `DATABASE_URL`.

## Schema

### `test_runs`

One row per Playwright suite execution. Inserted when the run starts so that an in-flight or crashed run remains visible in the database.

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `started_at` | `timestamptz` | No | `now()` |
| `finished_at` | `timestamptz` | **Yes** | `NULL` |
| `total` | `int4` | No | `0` |
| `passed` | `int4` | No | `0` |
| `failed` | `int4` | No | `0` |

**Constraints:**

- `test_runs_pkey`: Primary key on `id`.
- `test_runs_counts_non_negative`: `total >= 0 AND passed >= 0 AND failed >= 0` — counts cannot be negative.
- `test_runs_counts_within_total`: `passed + failed <= total` — test counts cannot exceed the total.
- `test_runs_finished_after_started`: `finished_at IS NULL OR finished_at >= started_at` — finished time must be after or equal to started time, or null.

**Index:** `test_runs_started_at_idx` on `started_at DESC` for ordering runs by recency.

### `heal_attempts`

One row per heal attempt, including failures.

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `test_run_id` | `uuid` | No | (foreign key to `test_runs`) |
| `spec_file` | `text` | No | — |
| `test_name` | `text` | No | — |
| `original_selector` | `text` | No | — |
| `proposed_selector` | `text` | **Yes** | `NULL` |
| `confidence` | `heal_confidence` | No | `'none'` |
| `tool_call_count` | `int4` | No | `0` |
| `status` | `heal_status` | No | `'investigating'` |
| `failure_reason` | `text` | **Yes** | `NULL` |
| `pr_url` | `text` | **Yes** | `NULL` |
| `transcript` | `jsonb` | No | `'{}'` |
| `created_at` | `timestamptz` | No | `now()` |

**Enums:**

- `heal_confidence`: `'high'`, `'low'`, `'none'`.
- `heal_status`: `'investigating'`, `'healed'`, `'needs_review'`, `'failed'`.

**Constraints:**

- `heal_attempts_pkey`: Primary key on `id`.
- `heal_attempts_test_run_id_fkey`: Foreign key to `test_runs(id)` with `ON DELETE CASCADE`.
- `heal_attempts_tool_call_count_within_cap`: `tool_call_count >= 0 AND tool_call_count <= 5` — prevents exceeding the hard cap on model-initiated tool calls.
- `heal_attempts_status_matches_confidence`: Enforces the status–confidence pairing:
  - `investigating` ↔ `none`
  - `healed` ↔ `high`
  - `needs_review` ↔ `low`
  - `failed` ↔ `none`
- `heal_attempts_selector_requires_verification`: `(proposed_selector IS NULL) = (confidence = 'none')` — a proposed selector exists if and only if the confidence is not `'none'`.
- `heal_attempts_pr_url_requires_high_confidence`: `pr_url IS NULL OR confidence = 'high'` — only high-confidence attempts may have a PR URL.

**Indexes:**

- `heal_attempts_test_run_id_idx` on `test_run_id` for joining to test runs.
- `heal_attempts_created_at_idx` on `created_at DESC` for ordering by recency.
- `heal_attempts_status_idx` on `status` for filtering by status.
- `heal_attempts_transcript_gin_idx` (GIN index) on `transcript` using `jsonb_path_ops` for JSONB containment queries.

## Documented deviations from `DESIGN.md`

The decisions below were escalations at the planning stage (Q2, Q3, Q4).

- **Q2**: `test_runs.finished_at` is `timestamptz NULL` (not strictly `NOT NULL`) and `total`, `passed`, `failed` are `NOT NULL DEFAULT 0`. This allows rows to be inserted when a run starts and updated when it finishes, so an in-flight or crashed run remains visible in the database.
- **Q3**: All timestamp columns (`started_at`, `finished_at`, `created_at`) use `timestamptz` (not `timestamp`). The tool is CI-oriented and runs are compared across machines and zones; `timestamptz` is the correct semantic.
- **Q4**: `heal_attempts.confidence` defaults to `'none'` (not left unset). `'none'` means "no verified fix", which is exactly true of a fresh attempt.

## Requirements

PostgreSQL **13.0 or higher** is required. The runner checks the server version on every migration run and rejects `< 13.0` with a clear error.

- **PostgreSQL 13** introduced `gen_random_uuid()` as a built-in function (no extension required).

## Adding a migration

Migrations are forward-only. To add a new migration after `0002_heal_attempts`:

1. Create a new file `db/migrations/0003_<snake_case_name>.sql`.
2. Write the DDL directly in SQL.
3. Run `npm run db:migrate` to apply it.

**Important:** An applied migration's file is never edited. The checksum is recorded in `schema_migrations`. If you discover a bug in an applied migration, write a new one (`0004_*`) to fix it. Editing an applied migration file causes a `checksum-mismatch` error on the next run.

## Persistence

The write functions in `db/repository.ts` are the only writers of `test_runs` and `heal_attempts` rows:

### Core functions (Task 4.2)

1. **`insertTestRun`** — inserts a `test_runs` row and returns the generated UUID. Called once per run.
2. **`finishTestRun`** — updates `test_runs.finished_at` when the run completes.
3. **`insertHealAttempt`** — inserts a `heal_attempts` row in `investigating` status with defaults for all other columns. The row is committed immediately before the agent runs, ensuring visibility into in-flight and crashed runs.
4. **`settleHealAttempt`** — updates a row from `investigating` to a terminal status (`healed`, `needs_review`, `failed`), populated with the heal result. The `WHERE status = 'investigating'` clause makes this idempotency-safe: a terminal row can never be overwritten.

### PR delivery functions (Task 5.1)

5. **`recordPrUrl`** — updates `heal_attempts.pr_url` for a settled `healed`/`high` attempt. Guarded by SQL: `WHERE status = 'healed' AND confidence = 'high' AND pr_url IS NULL`. Never called on a non-eligible attempt. Throws `not-found` if the attempt is not found or does not meet the guard conditions.

6. **`toDeliveryFailureSettleInput`** — maps a high-confidence assessment whose PR delivery failed to a `SettleHealAttemptInput` that settles the attempt as `needs_review`/`low`, **preserving** `proposed_selector` and the full `transcript` (which still records the gate's verdict as `confidence='high'`). Called only when the opener returns failure. The failure reason is prefixed with `pr-delivery-failed:` and clamped to 500 characters. Throws if the assessment is not PR-eligible.

### Transcript storage

The `transcript` column holds a `PersistedTranscript` envelope (see `db/transcript.ts`) containing the full `HealTranscript` plus outcome metadata. The envelope is built by `buildTranscriptEnvelope`, serialised by `serialiseTranscript`, and bound to the SQL parameter as a `::jsonb` value.

The serialisation uses a two-pass truncation guard:
- **Pass 1:** If the full envelope fits within `MAX_TRANSCRIPT_BYTES` (2 MB), store it verbatim and set `truncated: false`.
- **Pass 2:** Otherwise, replace `transcript.messages` with `[]` (removing the conversation history), then recursively clamp all string values deeper than `TRUNCATED_FIELD_CHARS` (4,000 characters) with a truncation marker. The result is persisted with `truncated: true`.

This ensures the snapshot and tool results remain queryable even for large transcripts, while always fitting in a reasonable database row.

### PR URL

The `pr_url` column is written only by `recordPrUrl` (Task 5.1). No other writer touches it; rows that do not have a PR are left with `pr_url IS NULL`.

When PR delivery fails (API error), the row is settled as `needs_review`/`low` with `pr_url IS NULL`. The gate's verdict (`confidence='high'`, `prEligible=true`) is preserved in the `transcript` column as `transcript->>'confidence' = 'high'` and `transcript->>'prEligible' = 'true'`. The `confidence` **column** reads `'low'` to reflect the operational state (delivery failed), but the transcript holds the true gate verdict for reference. Phase 7 (metrics) should compute the heal rate from `transcript->>'confidence'` if it wants a GitHub-independent number.

### High confidence and skipped entries

- A `high`-confidence fix produces a `status = 'healed'`, `confidence = 'high'` row with a non-null `proposed_selector`.
- Non-selector-drift failures (`classification = 'other'`) are counted in the run report but never inserted as `heal_attempts` rows. They are recorded in the classifier output, not the database.

### Read access (dashboard)

`dashboard/lib/attempts.ts` holds the only query the dashboard issues: a single bounded `SELECT` over `heal_attempts`, ordered `created_at DESC, id DESC`, limited to 200 rows. It deliberately does not select `transcript` — the list view has no use for it, and the column can reach 2 MB per row. The dashboard never writes: `db/repository.ts` remains the only writer of `test_runs` and `heal_attempts`.

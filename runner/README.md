# Runner

The runner is the orchestration layer that classifies Playwright test results, heals selector-drift failures using the agent loop, and persists the attempts to PostgreSQL.

## What the runner is

The runner reads an existing `test-results/results.json` file (produced by `npm run test:e2e`), classifies each failure as selector-drift or other, sends selector-drift failures to the heal agent sequentially, and writes one `test_runs` row and one `heal_attempts` row per attempt to PostgreSQL. It does **not** execute the Playwright suite itself — the suite is run separately with `npm run test:e2e`.

The runner's pipeline:
1. Read and classify `test-results/results.json`
2. Insert a `test_runs` row
3. For each selector-drift failure:
   - Insert a `heal_attempts` row in `investigating` status
   - Run the heal agent
   - Update the row with the result
4. Update `test_runs.finished_at`

## Command

```bash
npm run heal
```

### Flags

- `--results=<path>` — path to the Playwright results JSON (default: `test-results/results.json`)
- `--url=<url>` — app URL to test against (default: from `DEFAULT_APP_URL` in playwright-toolbox)
- `--spec=<path>` — only heal failures from a specific spec file
- `--json` — output the report as JSON instead of line-per-event format

### Example

```bash
# Run all heals
npm run heal

# Heal only tests/login.spec.ts, output as JSON
npm run heal -- --spec=tests/login.spec.ts --json

# Use a custom results file and app URL
npm run heal -- --results=my-results.json --url=http://staging.local:3000
```

## Environment

### `DATABASE_URL` (required)

PostgreSQL connection string. Example:

```
postgres://postgres:mend@localhost:5433/mend
```

If unset, the runner prints an error and exits with code 1. The connection string is never logged or printed to output.

### `OPENAI_API_KEY` (required)

OpenAI API key for the heal agent. Set in the environment or `.env` file before running.

### Prerequisites

- `npm run db:migrate` must have been run first to create the schema.
- The Playwright suite must have been executed with `npm run test:e2e` to produce `test-results/results.json`.
- The app must be running: `npm run start:app`.

## Exit codes

- **0** — success; all attempts settled (some may be `failed` if no fix was found)
- **1** — error (environment, database, or runtime error)
- **2** — usage error (invalid flags or arguments)
- **3** — one or more attempts left in `investigating` status (crash or stranding)

## The crash-visibility contract

This runner implements a strict contract: every attempt is recorded in the database before the agent runs, ensuring visibility into in-flight and crashed runs.

When an attempt is inserted, it is assigned `status = 'investigating'`. The row is committed to the database **immediately**, before the heal loop starts. If the runner crashes, is killed, or hits an invariant violation during healing, the row remains in the database with `status = 'investigating'`, timestamp set, and `transcript = '{}'`.

A stranded `investigating` row is never silently deleted, rewritten, or auto-resolved. It is a permanent, deliberate record that an attempt did not complete. Developers and CI tools can inspect the database to distinguish between:
- `status = 'healed'` — fix verified and high-confidence
- `status = 'needs_review'` — fix passed the test but needs human review
- `status = 'failed'` — no fix found
- `status = 'investigating'` — attempt was interrupted or stranded

The underlying insert-before-run and no-update-on-crash behavior is implemented in `runner/heal-run.ts` and verified by code inspection; automated integration proof of the kill-mid-run sub-case is currently blocked (runner/heal-run.ts never exposes its internal pg.Client via HealRunOptions, preventing external connection termination testing).

Stranded rows must be investigated by hand. The database is never auto-cleaned, and no "reset stuck attempts" feature exists. Developers clear the dev database as needed.

## What the runner does not do

- **No PR creation.** That is Task 5.1. The runner never writes to `pr_url`.
- **No auto-merge.** A human always reviews and merges.
- **No suite execution.** The runner reads the results file; the suite is run separately.
- **No persistence of skipped entries.** Non-selector-drift failures (`classification = 'other'`) are counted in the run report but never inserted as `heal_attempts` rows. They are recorded in the classifier output and the CLI summary, not the database.

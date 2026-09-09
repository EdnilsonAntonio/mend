# Dashboard

A read-only Next.js application that displays every recorded heal attempt from the Self-Healing E2E Tests runner.

## What this is

A read-only Next.js App Router dashboard. Server Components read PostgreSQL directly using `pg` and render a single-page HTML table. There is no API layer, and the dashboard never writes to the database.

## Install and run

First, install the dashboard's dependencies:

```bash
npm run dashboard:install
```

Then start the development server:

```bash
npm run dashboard:dev
```

The dashboard runs on **http://localhost:3200**.

Alternatively, for production:

```bash
npm run dashboard:build
npm run dashboard:start
```

Note: `dashboard/` is its own npm package with its own `package-lock.json`. The root package does not depend on React or Next.js. Running `npm run dashboard:install` inside this directory installs a separate `node_modules/` tree.

## Environment

### `DATABASE_URL`

PostgreSQL connection string pointing to the database the runner writes to. Example:

```
postgres://postgres:mend@localhost:5433/mend
```

When `DATABASE_URL` is unset, the dashboard renders a help panel instead of crashing. The connection string is never printed: pg error messages pass through `redactConnectionUrls` to strip usernames and passwords.

## Tests

Run the dashboard test suite:

```bash
npm run test:dashboard
```

The suite includes:

- **Pure tests** (`format.spec.ts`, `attempts.spec.ts`): always run, no database required.
- **Integration test** (`attempts.integration.spec.ts`): skips unless `MEND_TEST_DATABASE_URL` is set.

See `db/README.md` for how to set up a test database.

## What it shows

A table of every heal attempt, newest first, capped at 200 rows. Each row displays:

- **Attempt ID** (first 8 characters, no dashes)
- **Created (UTC)** — timestamp in `YYYY-MM-DD HH:MM:SS UTC` format
- **Spec file** — e.g., `specs/app.spec.ts`
- **Test** — the test name, truncated to 80 characters
- **Status badge** — `Investigating`, `Healed`, `Needs review`, or `Failed`
- **Confidence badge** — `High`, `Low`, or `None`
- **Selector change** — original selector → proposed selector (or — if no fix found)
- **Tool calls** — how many tool invocations the agent used (0–5)
- **PR link** — hyperlink to the GitHub PR (or — if no PR, or the URL is invalid)

When a heal attempt has a `failure_reason`, it is rendered immediately below the row as a second table row, spanning all nine columns. This makes failed and investigating attempts as legible as healed ones.

## What it deliberately does not do

- **No writes.** The dashboard is a read-only reporting surface. All writes go through `db/repository.ts`.
- **No transcript column.** The transcript JSONB field can reach 2 MB per row and is not needed on the list view. See Task 6.2 for the detail view.
- **No metrics, rates, or cost.** No percentages, heal rates, false-fix rates, average tool calls, or cost-per-heal. See Task 7.1 for analytics.
- **No pagination, filtering, sorting, search, or date ranges.** One bounded query, one order: `ORDER BY created_at DESC, id DESC LIMIT 200`. Newest first, always.
- **No grouping by test run.** Not required by the task description or the spec.
- **No auto-refresh, polling, or websockets.** Refresh the browser to reload.
- **No auth, sessions, or multi-tenancy.** The dashboard is local and read-only (`REQUIREMENTS.md`).
- **No approval, rejection, re-running, or merging.** The only action is clicking a PR link to see the pull request.
- **No design system, Tailwind, CSS-in-JS, or responsive breakpoints.** One hand-written CSS file.
- **No browser tests of the dashboard UI.** The test suite is Node-level only; HTTP behavior is verified with `curl`.

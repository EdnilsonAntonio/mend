-- 0001_test_runs
-- One row per Playwright suite execution. Inserted when the run starts, so
-- finished_at is NULL for an in-flight or crashed run. See db/README.md.

CREATE TABLE test_runs (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  total       integer     NOT NULL DEFAULT 0,
  passed      integer     NOT NULL DEFAULT 0,
  failed      integer     NOT NULL DEFAULT 0,

  CONSTRAINT test_runs_pkey PRIMARY KEY (id),

  CONSTRAINT test_runs_counts_non_negative
    CHECK (total >= 0 AND passed >= 0 AND failed >= 0),

  CONSTRAINT test_runs_counts_within_total
    CHECK (passed + failed <= total),

  CONSTRAINT test_runs_finished_after_started
    CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX test_runs_started_at_idx ON test_runs (started_at DESC);

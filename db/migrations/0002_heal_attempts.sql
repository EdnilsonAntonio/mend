-- 0002_heal_attempts
-- One row per heal attempt, including failures. Constraints below encode the
-- project's non-negotiable invariants at rest:
--   * only a high-confidence attempt may ever carry a pr_url
--   * status and confidence can never disagree
--   * a proposed_selector exists if and only if confidence is not 'none'
--   * tool_call_count can never exceed the hard cap of 5

CREATE TYPE heal_confidence AS ENUM ('high', 'low', 'none');
CREATE TYPE heal_status AS ENUM ('investigating', 'healed', 'needs_review', 'failed');

CREATE TABLE heal_attempts (
  id                uuid            NOT NULL DEFAULT gen_random_uuid(),
  test_run_id       uuid            NOT NULL,
  spec_file         text            NOT NULL,
  test_name         text            NOT NULL,
  original_selector text            NOT NULL,
  proposed_selector text            NULL,
  confidence        heal_confidence NOT NULL DEFAULT 'none',
  tool_call_count   integer         NOT NULL DEFAULT 0,
  status            heal_status     NOT NULL DEFAULT 'investigating',
  failure_reason    text            NULL,
  pr_url            text            NULL,
  transcript        jsonb           NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT heal_attempts_pkey PRIMARY KEY (id),

  CONSTRAINT heal_attempts_test_run_id_fkey
    FOREIGN KEY (test_run_id) REFERENCES test_runs (id) ON DELETE CASCADE,

  CONSTRAINT heal_attempts_tool_call_count_within_cap
    CHECK (tool_call_count >= 0 AND tool_call_count <= 5),

  CONSTRAINT heal_attempts_status_matches_confidence CHECK (
    (status = 'investigating' AND confidence = 'none')
    OR (status = 'healed' AND confidence = 'high')
    OR (status = 'needs_review' AND confidence = 'low')
    OR (status = 'failed' AND confidence = 'none')
  ),

  CONSTRAINT heal_attempts_selector_requires_verification
    CHECK ((proposed_selector IS NULL) = (confidence = 'none')),

  CONSTRAINT heal_attempts_pr_url_requires_high_confidence
    CHECK (pr_url IS NULL OR confidence = 'high')
);

CREATE INDEX heal_attempts_test_run_id_idx ON heal_attempts (test_run_id);
CREATE INDEX heal_attempts_created_at_idx ON heal_attempts (created_at DESC);
CREATE INDEX heal_attempts_status_idx ON heal_attempts (status);
CREATE INDEX heal_attempts_transcript_gin_idx
  ON heal_attempts USING gin (transcript jsonb_path_ops);

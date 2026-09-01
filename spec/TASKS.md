# TASKS.md

## Purpose

Logical execution order for building the Self-Healing E2E Tests system incrementally,
with the riskiest work first and the most mechanical work last.

Each task is one unit of the ABR loop: one plan, one build, one review.

**Task IDs are stable.** Plans live at `plans/<task-id>.md`.

---

# Roadmap

## Phase 1: Target and Breakage (Foundation)

### Objective

Have something to break, and know exactly how it breaks, before any AI is involved.

---

### Task 1.1 — Scaffold the app under test

**Status:** ✅ Done — see `plans/1.1.md`.

Minimal static app in `app-under-test/`: login form, nav bar, product card, submit
button. No framework required. Served locally on a fixed port.

**Acceptance criteria:**
* App serves on a known port via a single npm script.
* Contains at least 5 distinct interactive elements with stable initial selectors.
* Zero business logic beyond what tests need to interact with.

---

### Task 1.2 — Write the baseline Playwright suite

**Status:** ✅ Done — see `plans/1.2.md`.

Five specs in `tests/`, all passing against the pristine app.

**Acceptance criteria:**
* `npm run test:e2e` → 5/5 passing.
* Each test contains at least one real assertion (not just a click).
* Playwright configured to emit JSON results to a known path.

---

### Task 1.3 — Seed the five breakage scenarios

**Status:** ✅ Done — see `plans/1.3.md`.

Introduce deliberate drift into `app-under-test/`, controlled by a script so breakage can
be toggled on and off for demos.

| # | Scenario | Expected agent outcome |
| --- | --- | --- |
| 1 | Renamed `id` (`#login-btn` → `#signin-button`) | healed, high confidence |
| 2 | Renamed class used as selector | healed, high confidence |
| 3 | DOM restructure — element moved into a wrapper | healed, likely low confidence |
| 4 | Text content changed (`"Sign In"` → `"Log In"`) | healed |
| 5 | Element genuinely removed | **no fix found** |

**Acceptance criteria:**
* Breakage is toggleable via script, not manual editing.
* With breakage on, exactly 5 tests fail.
* Each failure's Playwright error signature is documented in the task output.
* Scenario 5 has no valid fix by construction.

> Scenario 5 is not filler. It is the proof that the agent knows when to stop, which is
> the hardest thing to demonstrate and the most convincing thing to show.

---

### Expected outcome of Phase 1

A repository where breakage is reproducible on demand and every failure mode is
understood before the agent sees it.

---

## Phase 2: Tools (Deterministic Layer)

### Objective

Build and test the agent's hands before giving it a brain. Every tool must work
standalone, driven by a plain script, with no model involved.

---

### Task 2.1 — `get_dom_snapshot`

**Status:** ✅ Done — see `plans/2.1.md`.

Capture the page DOM at failure point and prune it (strip scripts, styles, inline data,
comments) to a token-bounded representation.

**Acceptance criteria:**
* Returns valid HTML preserving structure, ids, classes, roles, and text.
* Output stays under a documented token ceiling for the test app.
* Callable standalone from a script with no OpenAI dependency.

---

### Task 2.2 — `query_selector`

**Status:** ✅ Done — see `plans/2.2.md`.

Given a candidate selector, report how many elements match and a short text preview of
each — without committing to anything.

**Acceptance criteria:**
* Returns `{ matchCount, previews[] }`.
* Correctly reports 0, 1, and >1 matches.
* Never throws on invalid selector syntax — returns a structured error instead.

---

### Task 2.3 — `run_single_test` with assertion-integrity check

**Status:** ✅ Done — see `plans/2.3.md`.

Copy the spec to a temp file, substitute only the failing selector, diff against the
original, reject any assertion weakening, then execute that single test.

**Acceptance criteria:**
* Original spec file is byte-identical after the call, always.
* Returns `{ passed, output }`.
* A diff removing or weakening an assertion is rejected **before** execution.
* A diff adding `.skip` or `.only` is rejected.
* Verified with a deliberately malicious diff as a test case.

> This is the highest-value task in the project. Budget accordingly.

---

### Expected outcome of Phase 2

Three tools that work, are individually tested, and are provably safe — before any
non-determinism enters the system.

---

## Phase 3: The Agent Loop

### Objective

Wire the tools to the model and heal a real failure.

---

### Task 3.1 — Failure classifier

**Status:** ✅ Done — see `plans/3.1.md`.

Rule-based mapping from Playwright error output to `selector-drift` vs `other`.

**Acceptance criteria:**
* Correctly classifies all 5 seeded scenarios.
* Non-selector failures are skipped and recorded, never sent to the model.

---

### Task 3.2 — Tool-calling loop against scenario 1 only

Hand-rolled OpenAI loop with a hard cap of 5 tool calls. Target: the renamed-`id` case.

**Acceptance criteria:**
* Heals scenario 1 end to end, verified by execution.
* Hard cap enforced and exercised by a test that forces cap exhaustion.
* Full tool-call transcript captured in memory.
* No path exists where a fix is returned without `run_single_test` passing.

---

### Task 3.3 — Extend to all five scenarios

**Acceptance criteria:**
* Scenarios 1, 2, 4 heal reliably across 3 consecutive runs.
* Scenario 3 heals or routes to review — never produces a wrong-element fix.
* Scenario 5 returns "no fix found" on all 3 runs. **This is a hard requirement.**

---

### Task 3.4 — Confidence gate

Implement the high/low/none rules from `DESIGN.md`.

**Acceptance criteria:**
* Confidence derived from observable signals only, never from the model's self-report.
* `none` never produces a PR path.
* Thresholds live in one named constant, not scattered literals.

---

### Expected outcome of Phase 3

A working agent whose failures are as well-behaved as its successes.

---

## Phase 4: Persistence

### Task 4.1 — Schema and migrations

`test_runs` and `heal_attempts` per `DESIGN.md`, versioned migrations.

**Acceptance criteria:**
* Migrations run clean on an empty database.
* Schema matches DESIGN.md exactly.

---

### Task 4.2 — Persist runs and attempts

**Acceptance criteria:**
* Every attempt persisted, including `failed` and `needs_review`.
* Transcript stored as queryable `jsonb`.
* A crash mid-heal leaves the row in `investigating`, never silently absent.

---

## Phase 5: Delivery

### Task 5.1 — GitHub PR creation

Branch, commit, PR via Octokit, with the diff and a reasoning summary in the body.

**Acceptance criteria:**
* PR opened only for `high` confidence.
* `pr_url` persisted.
* API failure marks the attempt as needing review — never loses the fix.

---

## Phase 6: Dashboard

### Task 6.1 — List view

All heal attempts, status badge, confidence, PR link, newest first.

### Task 6.2 — Detail view

Transcript replay: DOM seen, selectors tried, match counts, test output per step.

**Acceptance criteria:**
* A visitor can reconstruct the agent's full reasoning without reading the database.
* Failed attempts are as legible as successful ones.

---

## Phase 7: Evidence

### Task 7.1 — Metrics

Heal rate, average tool calls, cost per heal, false-fix rate (must be 0).

**Acceptance criteria:**
* Numbers derive from stored data, not manual counting.
* Reproducible via a single command.

---

# Recommended Execution Order

```text
Phase 1  Target and Breakage
    ↓
Phase 2  Tools           ← most of the real engineering lives here
    ↓
Phase 3  Agent Loop      ← most of the interesting difficulty lives here
    ↓
Phase 4  Persistence
    ↓
Phase 5  Delivery
    ↓
Phase 6  Dashboard
    ↓
Phase 7  Evidence
```

The dashboard is deliberately last. It is the most visually satisfying part and the least
technically risky — building it early would feel like progress while leaving every hard
problem unsolved.   
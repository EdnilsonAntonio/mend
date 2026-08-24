---
description: Runs the Architect → Builder → Reviewer loop for one task in spec/TASKS.md. Stops for human approval after the plan and after each review verdict, with a 3-round fix cap before escalating back to the Architect.
argument-hint: <task-id>
---

You are orchestrating one task from `spec/TASKS.md` through Mend's three specialized
subagents, in this strict order. The task id is given in $ARGUMENTS — if it is missing,
stop and ask for one instead of guessing which task to run.

1. **Invoke the `architect` subagent** with the task id from $ARGUMENTS. It reads
   `spec/REQUIREMENTS.md`, `spec/DESIGN.md`, and `spec/TASKS.md`, then writes
   `plans/<task-id>.md`. Do not proceed without that plan file existing on disk.

2. **STOP and present the plan to the user.** Show the plan's Goal, Files, and
   Acceptance Criteria sections. Ask explicitly whether to proceed to the Builder, or
   whether the plan needs changes first. Do not invoke the Builder until you get an
   explicit go-ahead — a plan silently approved is how a bad design decision turns into
   a day of rework instead of one paragraph of feedback.

3. **Invoke the `builder` subagent**, pointing it at the approved `plans/<task-id>.md`.
   It implements only what that plan specifies and reports back using its standard
   report format (Implemented / Verification / Deviations / Blocked).

   - If the Builder reports anything under "Blocked / unclear": stop here, surface it to
     the user, and route back to the `architect` to resolve the gap. Do not let the
     Builder guess its way past an unclear plan.

4. **Invoke the `reviewer` subagent**, passing it the task id and the Builder's report.
   It audits against `plans/<task-id>.md` and the spec, and returns a verdict of PASS
   or FAIL with a fix list.

5. **If the verdict is FAIL:**
   - Invoke the `builder` again, passing it **only** the Reviewer's fix list — not the
     original plan again, to keep the Builder focused on what's actually wrong.
   - Return to step 4.
   - Track rounds. **After 3 failed review rounds, stop the loop.** Do not invoke the
     Builder a 4th time. Instead report to the user: the task, the plan, and every
     Reviewer verdict so far. A task failing review three times means the *plan* is
     wrong, not the code — this goes back to the `architect` as a fresh planning pass,
     not another Builder attempt.

6. **When the verdict is PASS:**
   - Present a final summary: the task id and name, files changed, the Reviewer's
     verification output, and confirmation that all of the plan's acceptance criteria
     are checked off.
   - Ask the user whether to mark the task done in `spec/TASKS.md`. Do not edit
     `spec/TASKS.md` yourself without that confirmation — task status is a project
     record, not something to update silently.

## Project invariants to enforce regardless of what any plan says

If at any point the Builder's implementation or the Reviewer's findings suggest one of
these has been violated, treat it as an automatic FAIL and say so explicitly, even if
the Reviewer's own verdict says PASS:

- A proposed selector fix is never accepted without the test being re-executed.
- The agent can never make a test pass by removing or weakening an assertion.
- The healing loop's tool-call cap is enforced in the failure path, not just the happy
  path.
- Low-confidence fixes route to human review and never open a PR automatically.

## Optional argument

If $ARGUMENTS contains more than a task id — for example a note like "focus on the
assertion-diff edge case" — pass that as additional context to the `architect` when
invoking it in step 1.
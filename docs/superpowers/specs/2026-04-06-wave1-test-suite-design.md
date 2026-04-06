# Case Study Wave 1 Test Suite Design

## Goal

Apply the new SkyTest runtime/case-file model to Case Study by rewriting existing Case Study cases into file-backed definitions, then expanding to a depth-first, stable regression suite across student and teacher portals.

Wave 1 target is quality over count: approximately 15-25 robust end-to-end regression cases that each satisfy 3 consecutive `reset -> run` cycles.

## Locked Product Decisions

1. Wave 1 scope includes student portal and teacher portal.
2. Admin service coverage (the `admin` service in `.case-studies/case-study-app/docker-compose.yml`) is explicitly deferred to wave 2.
3. Existing `HAN-C02` and `HAN-C03` are replaced in-place by file-based catalog definitions.
4. Stability gate for wave 1 is 3 consecutive reset-run cycles for each promoted case.
5. Implementation strategy is risk-first vertical slices.

## Context And Current State

### Existing Case Study Harness

- Harness root: `.case-studies/case-study-app/.skytest`
- Existing orchestration:
  - `make -C .case-studies/case-study-app/.skytest reset`
  - `make -C .case-studies/case-study-app/.skytest apply-case-state`
  - `make -C .case-studies/case-study-app/.skytest export-case-state`
- Current snapshot source: `.case-studies/case-study-app/.skytest/han-cases.snapshot.json` (contains `HAN-C02`, `HAN-C03`).

### Relevant Product Surfaces

- Student routes under `.case-studies/case-study-app/web/student/src/routes/`
  - mock exam dashboard and paper flows (`math-paper1`, `math-paper2`, review/confirm pages).
- Teacher routes under `.case-studies/case-study-app/web/teacher/src/routes/`
  - inbox (`mock-exam-grading`), grading review, account management.
- Student feature components include strong `data-testid` usage in mock-exam flows.
- Teacher feature components currently rely more on role/text structure and have limited explicit `data-testid` anchors.

## Scope

### In Scope (Wave 1)

- Convert Case Study test-case authoring from snapshot-only workflow to file-backed case catalog usage.
- Rewrite `HAN-C02` and `HAN-C03` as file-based canonical cases.
- Add new student and teacher regression cases in risk-first slices.
- Validate each promoted case with 3-cycle reset-run stability.

### Out Of Scope (Wave 1)

- Admin service/API integration test coverage.
- Authgear admin integration deep coverage beyond what student/teacher portal flows require.
- Broad high-count smoke catalog (50+ cases) without robust assertions.

## Proposed Test Architecture

### Catalog Structure

Under `.case-studies/case-study-app/.skytest/`:

- `skytest.yaml`
  - runtime defaults for this checkout
  - test catalog include/exclude rules
- `tests/student/*.case.yaml`
- `tests/teacher/*.case.yaml`
- optional shared docs:
  - `tests/README.md` (ID scheme, conventions)

This structure keeps cases human-reviewable, git-trackable, and editable through SkyTest write-back.

### Case ID And Ownership Model

- Preserve and rewrite existing IDs:
  - `HAN-C02`
  - `HAN-C03`
- Add domain IDs for new coverage:
  - student: `HAN-Sxx`
  - teacher: `HAN-Txx`

ID ownership rule: one ID maps to exactly one source file path at a time.

### Selector Strategy

1. Prefer `data-testid` selectors (especially student flows).
2. Fall back to role/name selectors with constrained regex.
3. Avoid brittle positional selectors unless no stable alternative exists.

For teacher pages, if robust selectors are insufficient, add targeted `data-testid` instrumentation in high-risk controls as part of the same slice.

## Risk-First Vertical Slice Plan

### Slice A: Foundation Rewrite And Bootstrap

Objective: establish file-based baseline and login/dashboard invariants.

- Rewrite `HAN-C02` and `HAN-C03` into file catalog.
- Normalize shared login/bootstrap steps for student flows.
- Assert dashboard readiness using stable exam-card anchors.
- Validate launch behavior for Paper 2 with optional continue modal handling.

Deliverable: stable file-backed baseline equivalent to current DB snapshot intent.

### Slice B: Student Exam Core Behaviors

Objective: high-value student exam lifecycle confidence.

Candidate case themes:

- Paper 2 interaction persistence (select, navigate, return).
- submit confirmation dialog guards (checkbox/confirm path).
- review-route arrival and score summary visibility.
- Paper 1 confirm/review navigation sanity.
- leave/resume behavior where applicable.

Deliverable: robust regressions for student critical path from dashboard to review states.

### Slice C: Teacher Grading Inbox And Review

Objective: operational grading flow confidence for teacher portal.

Candidate case themes:

- inbox load with expected table rows.
- search/filter/sort behavior correctness.
- open/view action path to grading review route.
- review page navigation controls and score input constraints.

Deliverable: stable regressions for teacher grading throughput path.

### Slice D: Teacher Account Management

Objective: account-management operational safety.

Candidate case themes:

- tab switching profile/students.
- student list filtering/pagination interactions.
- password reset confirmation dialog flows (teacher self + student).

Deliverable: stable regressions for teacher account/admin-like interactions in portal scope.

## Case Design Standards

- Every case must validate one primary behavior and include explicit fail messages.
- Use deterministic assertions for:
  - route family (`/mock-exam/...`, `/mock-exam-grading/...`, `/account-management/...`)
  - required controls/widgets visible and interactive
  - domain outcome signals (review panels, grading fields, confirmation states)
- Cases should be independent and runnable in any order after reset.

## Validation And Promotion Rules

Promotion from draft to wave-1 suite requires:

1. single-run pass after reset;
2. 3 consecutive reset-run pass cycles;
3. no unresolved flaky behavior observed during those cycles.

If a case fails stability gate, it remains draft and is not counted toward wave-1 completion.

## Execution Mechanics

Standard cycle for stability checks:

1. `make -C .case-studies/case-study-app/.skytest reset`
2. run targeted case batch
3. record pass/fail evidence with run IDs
4. repeat for 3 cycles

Evidence should be tracked per case ID and per slice so unstable patterns are isolated quickly.

## Risks And Mitigations

1. **Teacher portal selector fragility**
   - Mitigation: add minimal `data-testid` anchors where role/text selectors are insufficient.
2. **Auth/session variance across flows**
   - Mitigation: shared bootstrap with explicit URL-state handling and bounded retries.
3. **Cross-case coupling from shared data state**
   - Mitigation: strict reset-first discipline and case independence checks.
4. **Growth in case count without reliability**
   - Mitigation: depth-first gate and draft-vs-promoted split.

## Wave 1 Completion Criteria

Wave 1 is complete when all are true:

- `HAN-C02` and `HAN-C03` are file-backed and stable.
- Student + teacher promoted suite reaches approximately 15-25 robust regressions.
- Each promoted case has passed 3 consecutive reset-run cycles.
- Admin service remains deferred and documented for wave 2.

## Wave 2 Preview (Not Implemented Here)

- Add coverage for admin service workflows referenced by `.case-studies/case-study-app/docker-compose.yml`.
- Extend to backend-admin and authgear-admin integration scenarios once portal baseline is stable.

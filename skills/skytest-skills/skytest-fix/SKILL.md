---
name: skytest-fix
description: >
  Diagnose and fix failed SkyTest test cases. Analyzes run reports, events,
  screenshots, and error traces to classify failures into a systematic taxonomy —
  then proposes targeted fixes and applies them via MCP after user confirmation.
  Default stabilization strategy: convert flaky ai-action interaction steps
  (clicks, fills, dropdowns, datepickers) to playwright-code with verified
  selectors. Use when a test run has failed and you need to investigate and fix
  the test case.
---

# SkyTest Fix Skill

Diagnose failed test runs and fix test cases systematically.

## Non-Negotiable Rules

- **Never apply fixes without user confirmation.** Present diagnosis and proposed fix first.
- **Never fabricate Playwright selectors.** Get them from a connected browser tool (Playwright MCP / Chrome DevTools MCP), screenshots showing exact labels, an existing passing step, or the user. Role/label locators from exact visible labels are acceptable for standard controls — verify live when a browser tool is connected.
- **Verify fixes with browser tools when available** — navigate to the failing page state, test the selector/interaction there, and only then propose it. Do this silently during investigation.
- **Trace the root cause before proposing.** A step often fails because a *previous* step left the page in the wrong state. Read the full event log and screenshots, not just the error message.
- **One fix at a time.** Fix the first failing step, re-run, then reassess. Don't speculate about downstream failures.
- **For anything unclear, ask the user.** Don't assume page structure or expected behavior.

## Playwright-First Stabilization

Validated in practice: deterministic interactions (clicking, filling, selecting dropdowns/datepickers/checkboxes) run far more reliably as `playwright-code` than as ai-action. When an ai-action **interaction** step fails or flakes:

- **Converting it to playwright-code is the default fix**, not a last resort — provided selector confidence is met (verified live, exact label known, or user-supplied).
- When converting one step, **scan the rest of the test case** for other ai-action interaction steps on the same screens. Propose converting them in the same update — it prevents the next flake and saves re-run cycles. Present as one batch for confirmation.
- Keep ai-action for visual/fuzzy verification, scrolling, and screens you cannot capture.

## Input

Accepts any of: run ID / test case ID, pasted run report, screenshots, or "test X fails on step 3". If only an ID is given, fetch everything first: `get_test_run` with `include: ["events", "artifacts"]` AND `get_test_case` (steps, variables, configs, last 5 runs).

## Failure Taxonomy

Classify every failure; the category drives the fix.

### F1: AI Model Surface Error — investigate deeper
**Signals:** `"failed to call AI model service"`, `"empty content"`, `"model timeout"`, `"rate limit"`.
These are wrappers, not root causes. Check in order: (1) unresolved `{{VARIABLE}}` → F7; (2) page in wrong state from previous step → F5; (3) element below viewport / not loaded → F2; (4) vague step description → rewrite, or convert to playwright-code; (5) small icon / complex widget → F2/F3. Only if all check out → transient; suggest re-run.

### F2: Element Not Found
**Signals:** `"element not found"`, repeated locate cycles, locate-phase timeout.
Fixes: below viewport → add scroll step; not loaded → add verification gate; label mismatch → fix text to match actual UI; iframe/shadow DOM → playwright-code or flag; blocked by modal → dismiss first; UI changed → update step. For standard controls, **prefer converting to playwright-code with the correct label** over rewording ai-action.

### F3: Interaction Failure
**Signals:** element located but action had no effect; AI retried the same action.
Classic offenders: native `<select>`, custom date/time pickers, drag-and-drop, rich text editors, small icon buttons, special key sequences. **Fix: convert to playwright-code with verified selectors** (`selectOption()`, picker interactions, `fill()`, keyboard APIs). This is the canonical playwright-first case.

### F4: Assertion Failure
**Signals:** failing step is a verify/assert; expected content absent.
Fixes: dynamic data → assert presence/format, not exact value; minor text drift → match actual text; below viewport → scroll first; timing → add gate before assertion; **genuine app bug → report to the user, never "fix" the test to mask it**.

### F5: Navigation / State Error
**Signals:** wrong page in screenshot, unexpected URL/modal/login prompt.
Fixes: handle the unexpected modal; check the login step completed; add a gate after the previous step; empty state → fixture data precondition.

### F6: Timing Issue
**Signals:** intermittent pass/fail, `"not yet visible"`, loading spinner in screenshot.
Fix: add a verification gate between trigger and failing step — `await expect(landmark).toBeVisible()` in playwright-code, or ai-action "Verify [landmark] is visible". Prefer gates over arbitrary waits.

### F7: Variable / Configuration Error
**Signals:** `{{VARIABLE}}` appears literally in events; value mismatched to field type.
Fix: add/correct the variable definition (test case or project level); check name spelling between step text and variable. `{{TIMESTAMP}}` is not built-in — needs a `RANDOM_STRING` variable with a generation type.

### F8: Playwright Code Error
**Signals:** `"Timeout"`, `"strict mode violation"`, `"locator resolved to N elements"` from a playwright-code step.
Fixes: outdated selector → inspect actual page, update; multiple matches → `{ exact: true }`, parent scoping (`getByRole('row', { name: /…/ })`), or `.first()`; not visible → scroll/gate first; wrong page → check the previous navigation. Do not fall back to ai-action for a deterministic interaction just because a selector broke — fix the selector.

### F9: Environment / Infrastructure Error
**Signals:** DNS/network errors, `"browser crashed"`, `"target closed"`, `ERR_CONNECTION_REFUSED`.
**Do not modify the test case.** Advise checking target app availability and runner status (`list_runner_inventory`), then re-run.

## Workflow

### 1. Gather Context
1. `get_test_run` with `include: ["events", "artifacts"]` (or parse the pasted report).
2. `get_test_case` for current steps, variables, targets, and last 5 runs — a previously passing test suggests UI change or environment; never-passed suggests a design flaw.
3. Find the first `[ERROR]` step; read all preceding events and the screenshots at and before the failure.

### 2. Classify
Decision order: infrastructure → **F9**; playwright-code error → **F8**; unresolved variable → **F7**; wrong page/modal in screenshot → **F5**; failing step is an assert → **F4**; "AI model" error → investigate per F1 before accepting it; locate attempts failed → **F2**; located but ineffective → **F3**; intermittent/"not visible" → **F6**. If ambiguous, say so and ask.

### 3. Investigate
- Check all `{{VAR}}` references against test-case and project variables first — the most common hidden cause.
- Check the screenshot from the step *before* the failure.
- If a browser tool is connected: reproduce the page state, inspect the element, and **test the proposed selector live** before proposing. Ask for a direct URL if the page needs deep navigation.
- No browser tool: ask for a screenshot of the failing screen with the element visible, or the selector from the user's DevTools.

### 4. Propose

```markdown
## Diagnosis
**Failing step:** Step [N] — "[action text]"
**Classification:** [F1–F9]: [name]
**Root cause:** [concise]
**Evidence:** [events/screenshots supporting it]

## Proposed Fix
### Option A [recommended]
**Step [N]:** From `[current]` → To `[proposed]` (type: ai-action | playwright-code)
[Inserted steps, added variables, related steps to convert in the same update]
**Why this fixes it:** [root cause → fix]
```

Include the related-steps conversion batch (per Playwright-First Stabilization) when applicable.

### 5. Apply After Confirmation
1. `update_test_case` with corrected steps/variables/config (include `activeRunResolution` if runs are active).
2. Report exactly what changed.
3. Ask: "Re-run to verify the fix?"
4. Same step fails again → don't re-propose the same fix; investigate the new error. Different step fails → diagnose separately (expected when fixing multi-issue cases one at a time).

### 6. Recurring Failures
If a step keeps failing across attempts: check whether you're oscillating between approaches; get exact selectors from the user's DevTools or a live browser-tool session; if the flow is fundamentally un-automatable (CAPTCHA, email/OTP, file upload, multi-tab), flag it and recommend manual testing for that part.

## Common Fix Patterns

**Native dropdown → playwright-code**
```javascript
await page.getByRole('combobox', { name: 'Status' }).selectOption('Active');
```

**Date picker → playwright-code**
```javascript
await page.getByRole('textbox', { name: 'Start Date' }).fill('2026-04-15');
// or, calendar popup:
await page.getByRole('textbox', { name: 'Start Date' }).click();
await page.getByRole('gridcell', { name: '15' }).click();
```

**Icon button → scoped playwright-code** (preferred over rewording)
```javascript
await page.getByRole('row', { name: /School ABC/ }).getByRole('button', { name: 'Edit' }).click();
```

**Missing scroll** — insert ai-action `"Scroll down to the bottom of the form"` before the interaction.

**Timing gap** — insert a gate between action and next step:
```javascript
await page.getByRole('button', { name: 'Save' }).click();
await expect(page.getByText('Record saved')).toBeVisible();
```

**Dynamic data assertion** — `Verify the "Total Users" field shows a number` instead of an exact value.

**Unresolved variable** — add `{ "name": "SEARCH_KEYWORD", "type": "VARIABLE", "value": "…" }` to the test case (or project config if shared).

**Strict mode violation** — narrow with `{ exact: true }`, parent scoping, or `.first()`.

**File upload** — `setInputFiles` only works with attached test files; otherwise flag as un-automatable.

## Batch Fix Mode

When asked to fix many failures: `list_test_runs` with `status: "FAIL"` → group by classification → let the user prioritize → fix one case at a time starting with the most common pattern → then offer: "The same fix likely applies to [X, Y] — apply it there too?"

## What This Skill Does NOT Do

- **Fix app bugs** — report real failures; never adjust the test to mask them.
- **Redesign test cases** — if the approach is fundamentally wrong, recommend recreating via the `skytest` skill.
- **Fix infrastructure** — F9 failures are not test case issues.

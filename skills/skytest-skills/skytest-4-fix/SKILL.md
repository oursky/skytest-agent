---
name: skytest-4-fix
description: >
  Diagnose and fix failed SkyTest test cases. Analyzes run reports, events,
  screenshots, and error traces to classify failures into a systematic taxonomy
  — then proposes targeted fixes (step rewording, playwright-code conversion,
  scroll/wait insertion, variable corrections) and applies them via MCP after
  user confirmation. Use when a test run has failed and you need to investigate
  and fix the test case.
---

# SkyTest Fix Skill

Diagnose failed test runs and fix test cases systematically.

## Non-Negotiable Rules

- **Never apply fixes without user confirmation.** Present the diagnosis and proposed fix first. Apply only after explicit approval.
- **Never guess Playwright selectors.** If converting an ai-action to playwright-code, inspect the actual target app (via Chrome DevTools MCP, user screenshots, or user guidance) to get real selectors. Do not fabricate selectors.
- **Always trace the root cause before proposing fixes.** A step may fail because of an issue in a *previous* step. Read the full event log and check screenshots — don't just look at the error message.
- **One fix at a time.** When multiple issues exist, fix the first failing step, then suggest re-running. Don't speculate about downstream failures — they may resolve once the upstream step is fixed.
- **For anything unclear, ask the user.** Do not assume page structure, element names, or expected behavior. If evidence is ambiguous, ask.

## Input

Accepts one or more of:

1. **Test run report** — pasted by the user (like the agent run report format) or fetched via `get_test_run` with `include: ["events", "artifacts"]`
2. **Test case definition** — fetched via `get_test_case` or provided inline
3. **Screenshots** — from test run artifacts or user-provided (at the point of failure and the step before)
4. **User description** — "test SCHLS-003 is failing on step 3"

If only a test case ID or run ID is provided, fetch the full data via MCP tools before starting analysis. Always get both the **run data** (events, error) and the **test case definition** (steps, variables, configs).

## Failure Taxonomy

Classify every failure into one of these categories. The category drives the fix strategy.

### F1: AI Model Surface Error (Investigate Deeper)

**Signals:** `"failed to call AI model service"`, `"empty content from AI model"`, `"model timeout"`, `"rate limit"`

**These error messages are surface-level wrappers — not root causes.** The Midscene AI model call can fail for many reasons unrelated to the model itself. Always investigate deeper before concluding "the AI model had a problem."

**Common actual causes hiding behind this error:**
- **Missing or unresolved variables** — `{{VARIABLE}}` not defined in test-case or project configs, causing a malformed request to the AI model → actually **F7**
- **Page in unexpected state** — previous step didn't complete, page shows error/login/empty state instead of expected content → actually **F5**
- **Element not visible or not on screen** — target below viewport, behind modal, or not yet loaded → actually **F2**
- **Ambiguous step description** — the AI model couldn't produce a valid plan for a vague instruction → rewrite the step with specific element context
- **Small unlabeled icon or complex widget** — model can't reliably identify it from the screenshot → actually **F2** or **F3**, may need playwright-code
- **Genuinely transient model issue** — API overload, rate limit, network glitch → re-run (but rule out all above first)

**Fix strategy — investigate in this order:**
1. Check if all `{{VARIABLE}}` references in the failing step have matching variable definitions (test-case level AND project level)
2. Check screenshots from the step before — is the page in the expected state?
3. Check if the step description is clear and specific enough for the element type
4. Check if the target element is a small icon, native control, or complex widget that may need playwright-code
5. Only if all above check out → classify as transient and suggest re-run

### F2: Element Not Found

**Signals:** `"element not found"`, `"unable to locate"`, AI attempted multiple locate cycles without success, or step timed out during locate phase

The AI understood the instruction but could not find the element on the visible page.

**Common causes & fixes:**
- **Below viewport** → add scroll step before the failing step
- **Not yet loaded** → add a verification gate step (assert a landmark visible) before the failing step
- **Label mismatch** → update the step text to match the actual UI label (check screenshots)
- **Inside iframe/shadow DOM** → flag limitation; may need playwright-code
- **Hidden behind modal/overlay** → add a step to dismiss the blocking element first
- **UI changed** → update the step to reflect the current UI

### F3: Interaction Failure

**Signals:** Element was located (visible in events) but the action didn't produce the expected result — subsequent steps fail, or the AI retried the same action

The AI found and interacted with the element, but the interaction didn't work as expected.

**Common components that fail with ai-action:**
- Native `<select>` dropdowns → use `selectOption()` in playwright-code
- Custom date/time pickers → use playwright-code to interact with picker components
- File upload inputs → requires test file; flag if not supported
- Drag-and-drop → requires playwright-code with mouse events
- Rich text editors (contenteditable) → use playwright-code to type into the editor
- Small icon buttons → convert to playwright-code targeting the exact element
- Inputs requiring special key sequences (Tab, Enter, Escape) → playwright-code

**Fix strategy:** Convert the failing step to playwright-code with precise selectors. Inspect the actual target app to get correct selectors.

### F4: Assertion Failure

**Signals:** Failing step is a verify/assert/check step; expected content not found on page

The page did not show what the test expected.

**Common causes & fixes:**
- **Dynamic data changed** → assert presence or format instead of exact value
- **Text slightly different** (case, whitespace, truncation, extra punctuation) → fix expected text to match actual
- **Element below viewport** → add scroll step before the assertion
- **Timing** (assertion runs before page updates) → add verification gate or wait step before the assertion
- **UI text updated** since test was created → update expected text
- **Genuinely failed** (the app has a bug) → confirm with user; do not "fix" the test to hide a real bug

### F5: Navigation / State Error

**Signals:** Step fails with wrong page visible in screenshots, unexpected URL, modal/dialog blocking, or login prompt appearing

The test reached a page state the steps didn't anticipate.

**Common causes & fixes:**
- **Unexpected modal/dialog** → add a step to handle it (close, confirm, or dismiss)
- **Session expired** → check if login step completed properly; may need longer timeout on login
- **Redirect not followed** → add wait-for-navigation between steps
- **Previous step incomplete** → add verification gate after the previous step
- **Empty state** (no data on page) → note as precondition issue; fixture data may be missing

### F6: Timing Issue

**Signals:** Intermittent failures (passes sometimes, fails others), `"not yet visible"`, `"not interactable"`, or screenshot shows loading spinner/skeleton

The step executed before the page was ready.

**Fix strategy:** Add a verification gate step between the triggering action and the failing step. Use ai-action: `"Verify [expected landmark] is visible"` or `"Wait for [N] seconds"` as a last resort. Prefer verification gates over arbitrary waits.

### F7: Variable / Configuration Error

**Signals:** `{{VARIABLE}}` appears literally in events (not resolved), or step uses a value that doesn't match the field type

**Fix strategy:** Add the missing variable definition to the test case or project config. Fix the variable type or value. Check for spelling mismatches between step text and variable name.

### F8: Playwright Code Error

**Signals:** Error from a `playwright-code` step — `"Timeout"`, `"strict mode violation"`, `"locator resolved to N elements"`, `"element not visible"`

**Common causes & fixes:**
- **Selector outdated** (UI changed) → inspect actual page, update selector
- **Multiple matches** → make selector more specific (add `{ exact: true }`, use parent scoping, or add more role/name constraints)
- **Element not visible** → add scroll or wait before the code step
- **Wrong page** → verify previous navigation step completed

### F9: Environment / Infrastructure Error

**Signals:** Network errors, DNS failure, `"browser crashed"`, `"target closed"`, connection refused, `"ERR_CONNECTION_REFUSED"`

Not a test case issue. The target app or runner infrastructure had a problem.

**Fix strategy:** Do **not** modify the test case. Advise the user to check target app availability and runner status, then re-run.

## Workflow

### 1. Gather Failure Context

Collect all available information before diagnosing:

1. **Get the test run** — call `get_test_run` with `include: ["events", "artifacts"]`, or parse the user-provided report
2. **Get the test case** — call `get_test_case` for current steps, variables, and targets
3. **Identify the failing step** — find the first step with an `[ERROR]` event
4. **Read preceding events** — did earlier steps succeed cleanly? Any warnings, retries, or unexpected states?
5. **Check screenshots/artifacts** — what did the page look like at failure time? What about the step before?
6. **Check run history** — call `get_test_case` to see last 5 runs. Has this test ever passed? Did it start failing recently? A test that used to pass suggests a UI change or environment issue.

### 2. Classify the Failure

Match the error signature to the taxonomy (F1–F9).

**Decision tree:**

1. Is the error from infrastructure (network, crash, connection)? → **F9**
2. Is the error from a `playwright-code` step (selector timeout, strict mode)? → **F8**
3. Is there an unresolved `{{VARIABLE}}` in the logs or step text, or are variable definitions missing? → **F7**
4. Does the screenshot show the wrong page, unexpected modal, login prompt, or error page? → **F5**
5. Is the failing step a verify/assert step? → **F4**
6. **Does the error mention AI model service issues** (`"failed to call AI model service"`, `"empty content"`, `"model timeout"`)? → **Do NOT classify as F1 yet.** This is a surface error — investigate the actual cause:
   - a. Re-check variable definitions for this step → may be **F7**
   - b. Check page state in screenshots from the step before → may be **F5**
   - c. Check if element is a small icon, unlabeled, or below viewport → may be **F2**
   - d. Check if element is a native control or complex widget → may be **F3**
   - e. Is the step description vague or ambiguous? → rewrite the step (see F2/F3 fixes)
   - f. Only if all above check out and no clear cause is found → **F1** transient model issue, suggest re-run
7. Did the events show locate attempts that all failed? → **F2**
8. Did the events show a successful locate but failed action? → **F3**
9. Is the failure intermittent or shows "not visible/interactable"? → **F6**

If the failure doesn't fit cleanly, explain the ambiguity to the user and ask for clarification (e.g., "Can you check if this element is visible when you manually navigate to this page?").

### 3. Investigate Root Cause

Based on the classification, dig deeper:

**For F1 (AI model surface error) — investigate the actual cause first:**
- Check all `{{VARIABLE}}` references in the failing step against test-case variables and project configs — missing variables are the most common hidden cause
- Check the screenshot from the step *before* the failure — is the page in the expected state, or did something go wrong upstream?
- Then proceed to element-level investigation below

**For F2 / F3 (element issues):**
- Examine the failing step's action text — is it specific enough?
- Check screenshots: is the target element visible? Is it a small icon, unlabeled button, or complex widget?
- If Chrome DevTools MCP is connected: navigate to the same page state as the failing step and inspect the element. Get the accessible role, name, and a reliable selector.
- If no browser tools: ask the user for a screenshot of the page at the failing step, or ask them to describe the element.

**For F4 (assertion failures):**
- Compare expected text in the step against the actual page content visible in screenshots
- Determine if the mismatch is a data change, timing issue, or genuine app bug
- If it looks like a real bug: tell the user — do not "fix" the test to mask a real issue

**For F5 / F6 (state/timing):**
- Check what happened in the step *immediately before* the failure
- Look for page transitions, loading indicators, or state changes in screenshots
- Determine if adding a verification gate or wait would resolve it

**For F7 / F8 (variable/playwright issues):**
- For variables: compare step text `{{VAR}}` references against test case variables and project configs
- For playwright: identify which line failed (from error trace) and which selector is broken

### 4. Propose Fix

Present the diagnosis and one or more fix options. Use this format:

```markdown
## Diagnosis

**Failing step:** Step [N] — "[action text]"
**Classification:** [F1–F9]: [category name]
**Root cause:** [concise explanation]
**Evidence:** [what in the events/screenshots/error supports this conclusion]

## Proposed Fix

### Option A [recommended]
[Describe what changes and why]

**Step [N] change:**
- From: `[current action text or code]`
- To: `[proposed action text or code]`
- Type: `[ai-action or playwright-code]`

[Any additional changes: new steps inserted, variables added, steps reordered]

### Option B [alternative]
[Describe alternative approach]

**Why this fixes it:** [connect root cause to fix]
```

**Guidelines for fix proposals:**
- **F1 (AI model surface error):** Do NOT default to "just re-run." First investigate variables, page state, and element specificity per the F1 taxonomy. Only recommend re-run if no concrete cause is found after thorough investigation.
- **F2 (element not found):** Prefer rewriting the ai-action with more specific wording before converting to playwright-code.
- **F3 (interaction failure):** Playwright-code is usually the right fix for native controls and complex widgets.
- **F4 (assertion failure):** Prefer adjusting the expected value over removing the assertion. If it's a real bug, say so.
- **F5 / F6 (state/timing):** Prefer adding a verification gate step (`"Verify [landmark] is visible"`) over arbitrary wait times.
- **F7 (variable):** Fix the variable definition directly — straightforward.
- **F8 (playwright code):** Update selectors from actual DOM inspection. If the UI changed heavily, consider falling back to ai-action.
- **F9 (environment):** Do not modify the test. Recommend re-run after checking infrastructure.

**When playwright-code is needed but browser tools are unavailable:**
1. Ask the user to provide a screenshot of the failing page with the target element visible
2. Ask the user to inspect the element in their browser and share the selector
3. Or suggest connecting Chrome DevTools MCP for the investigation
4. If none are feasible, propose a more descriptive ai-action as a best-effort alternative

### 5. Apply Fix After Confirmation

Once the user approves:

1. Call `update_test_case` with the corrected steps, variables, or config
2. Report exactly what was changed (step numbers, old vs. new text)
3. Ask: **"Want to re-run this test case to verify the fix?"**
4. If they re-run and it fails again on the **same step** — do not re-propose the same fix. Investigate the new error, which may reveal a different root cause.
5. If it fails on a **different step** — diagnose the new failure separately. This is expected when fixing multi-issue test cases one step at a time.

### 6. Handle Recurring Failures

If the same step keeps failing after multiple fix attempts:

1. Review all previous attempts — are we oscillating between approaches?
2. Consider whether the element/flow is fundamentally unreliable for AI automation
3. Escalation options:
   - Ask the user to provide exact selectors from their browser's DevTools
   - Suggest re-running `/skytest-1-explore` with Playwright MCP for this specific screen to get verified selectors
   - If the flow is un-automatable (CAPTCHA, file upload without support, external auth), flag it per `/skytest-2-plan` automation boundaries and recommend manual testing

## Common Fix Patterns

Quick reference for frequent fixes. Use these as starting points — always verify against the actual failure data.

### Icon Buttons → More Specific Description or Playwright Code

Icons without text labels are unreliable for AI location.

**Before (ai-action):** `Click the View (eye) icon on the first school row in the table`

**Fix A — more specific ai-action:** `In the schools table, click the action button in the rightmost column of the first data row`

**Fix B — playwright-code (if selectors available):**
```javascript
await page.getByRole('row').nth(1).getByRole('link', { name: /view/i }).click();
```

### Native Dropdown → Playwright Code

Native `<select>` elements often don't respond reliably to AI clicks.

**Before (ai-action):** `Select "Active" from the "Status" dropdown`

**After (playwright-code):**
```javascript
await page.getByRole('combobox', { name: 'Status' }).selectOption('Active');
```

### Custom Date Picker → Playwright Code

Complex date pickers with calendar popups need deterministic interaction.

**Before (ai-action):** `Set the "Start Date" to "2026-04-15"`

**After (playwright-code):**
```javascript
await page.getByRole('textbox', { name: 'Start Date' }).click();
await page.getByRole('gridcell', { name: '15' }).click();
```

Or if the input accepts typed dates:
```javascript
await page.getByRole('textbox', { name: 'Start Date' }).fill('2026-04-15');
```

### Missing Scroll → Insert Scroll Step

Elements below the viewport are invisible to the AI.

**Before:**
```
Step 5: [ACTION] Click the "Submit" button
```

**After:**
```
Step 5: [ACTION] Scroll down to the bottom of the form
Step 6: [ACTION] Click the "Submit" button
```

### Timing Gap → Insert Verification Gate

Previous action hasn't completed when next step starts.

**Before:**
```
Step 3: [ACTION] Click "Save"
Step 4: [ACTION] Click "Back to List"  ← fails: page still processing save
```

**After:**
```
Step 3: [ACTION] Click "Save"
Step 4: [ASSERT] Verify success message "Record saved" is visible
Step 5: [ACTION] Click "Back to List"
```

Prefer verification gates over arbitrary waits. A gate step like `"Verify [landmark] is visible"` naturally waits for the page to reach the right state.

### Dynamic Data → Presence/Format Assertion

Exact-value assertions break when data changes between runs.

**Before:** `Verify the "Total Users" field shows "1,234"`

**After:** `Verify the "Total Users" label and its value are visible` or `Verify the "Total Users" field shows a number`

### Unresolved Variable → Add Variable Definition

**Before:** Step text uses `{{SEARCH_KEYWORD}}` but no variable `SEARCH_KEYWORD` is defined.

**Fix:** Add variable to the test case:
```json
{ "name": "SEARCH_KEYWORD", "type": "VARIABLE", "value": "the actual search term" }
```

### Playwright Strict Mode → Narrow Selector

**Before (fails with "strict mode violation, locator resolved to 2 elements"):**
```javascript
await page.getByRole('button', { name: 'Edit' }).click();
```

**After:**
```javascript
await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
```

Or scope to a parent:
```javascript
await page.getByRole('row', { name: /School ABC/ }).getByRole('button', { name: 'Edit' }).click();
```

### File Upload → Flag or Test File

File upload fields cannot be automated via ai-action.

**Options:**
1. If the test platform supports test file attachments — ask user to upload the file and reference it
2. Use playwright-code: `await page.getByLabel('Upload File').setInputFiles('/path/to/file');`
3. If neither works — flag the step as un-automatable and recommend manual testing

## Batch Fix Mode

When the user asks to review and fix multiple failed test cases at once:

1. Call `list_test_runs` with `status: "FAIL"` to find all recent failures
2. Group failures by classification (e.g., "3 tests failed on element location, 2 on timing")
3. Present the summary — let the user prioritize which to fix first
4. Fix one test case at a time, starting with the most common failure pattern (fixing one often reveals the fix for similar cases)
5. After fixing a pattern, suggest: "The same fix likely applies to [test X, test Y]. Want me to apply it to those as well?"

## What This Skill Does NOT Do

- **Fix app bugs.** If the test correctly identifies a broken feature, report it as a real failure — do not "fix" the test to mask it.
- **Redesign test cases.** If the test case's fundamental approach is wrong (testing the wrong flow, wrong assumptions), recommend re-running `/skytest-2-plan` for that section.
- **Fix infrastructure.** For F9 (environment) failures, advise the user to check their runner and target app — the test case itself is fine.
- **Generate login code.** If the login step needs fixing, recommend re-running `/skytest-1-explore` with Playwright MCP to get verified login code.

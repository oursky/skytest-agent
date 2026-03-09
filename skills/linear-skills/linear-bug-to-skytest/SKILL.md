---
name: linear-bug-to-skytest
description: >
  Convert a Linear bug report into one or more SkyTest regression test cases — verifying
  the bug is fixed and the expected behavior works correctly. Use this skill whenever the
  user shares a Linear issue link or ID that is a BUG and wants to create a regression test
  from it. Triggers on phrases like "create a test from this bug", "regression test for
  SKY-123", "convert this bug to SkyTest", "make a test case for this bug ticket", or when
  a Linear bug link is shared alongside testing intent. This skill is designed for bug reports
  specifically — not for feature tasks, user stories, or development requirements. Supports
  create/update, direct run trigger, run querying, project config management, and runner
  inventory lookup through SkyTest MCP tools.
---

# Linear Bug → SkyTest Regression Test Skill

You bridge two systems: **Linear** (bug tracking) and **SkyTest** (test automation). Your
job is to read a bug report, understand what went wrong, and turn it into regression test
cases that verify the fix works — so the same bug can never silently come back.

## CRITICAL SAFETY RULES

- **NEVER create a test case without explicit user confirmation.** Show the full draft first.
- **NEVER create more than one test case per `create_test_case` call.**
- **NEVER guess UI steps** — if any step is ambiguous, ask the user.
- **NEVER hardcode credentials or URLs** — always use `{{VARIABLE}}` placeholders.
- **NEVER change the Linear issue** — this skill is read-only on Linear.
- **NEVER send `FILE` variables through MCP create.** SkyTest does not support file attachments via UI either — skip file-type configs entirely.
- **NEVER attempt to read, download, or process video files** (`.mov`, `.mp4`, `.webm`, `.avi`, `.mkv`) — not even if the user asks. Ask for screenshots or text descriptions instead.
- **NEVER force a test case that can't be fully automated.** If a step requires something outside SkyTest's capabilities, flag it honestly and suggest manual testing for that part (see "Automation Boundaries" below).

## Automation Boundaries

SkyTest can only automate what happens inside a **clean browser session** or an **installed Android APK**. It executes explicit UI instructions step by step — nothing more.

**If any step in the bug's flow requires actions outside the browser or APK, that step cannot be automated.** Common examples:

- Checking email (e.g., email verification, password reset links)
- Receiving or entering OTP / SMS codes
- Interacting with third-party auth popups that leave the app's domain (e.g., payment methods that open in another app or a new tab, OAuth to external provider)
- Controlling external hardware or devices (e.g., printers, scanners, Bluetooth)
- Verifying push notifications outside the app
- File system operations on the user's machine (e.g., verifying a downloaded file's contents)
- Backend-only validation (e.g., checking database records, API responses, logs)
- Waiting for async processes that have no visible UI indicator (e.g., background jobs, webhooks)

**When you encounter these:**
1. Do NOT try to create a test case that includes the un-automatable step — it will fail every run.
2. Tell the user clearly: "This step requires [email/OTP/etc.] which SkyTest can't automate."
3. Suggest splitting the flow: automate what you can (everything before and after the manual step), and recommend the user test the un-automatable part manually.
4. If the entire flow is un-automatable (e.g., the whole bug is about OTP delivery), skip the test case and explain why.

## MCP Tools Available

**SkyTest tools:**

| Tool | Purpose |
|------|---------|
| `list_projects` | List user's SkyTest projects |
| `get_project` | Project details + project-level configs |
| `list_test_cases` | List test cases (check for existing regression tests) |
| `get_test_case` | Full case: steps, configs, last 5 runs |
| `create_test_case` | Create exactly one test case per call |
| `run_test_case` | Queue one run for a test case with optional overrides |
| `list_test_runs` | List runs with filters and optional events/artifacts |
| `manage_project_configs` | Upsert/remove project-level configs in one call |
| `list_runner_inventory` | List runner/device inventory and Android selector options |

**Linear tools (read-only):**

| Tool | Purpose |
|------|---------|
| `get_issue` | Fetch issue details: title, description, labels, status |
| `list_comments` | Read all comments on an issue — often contain extra context, workarounds, or sample data |
| `extract_images` | **View screenshots embedded in the issue description or comments** — critical for extracting test data |

## Workflow

### Step 1: Receive and Study the Bug Report

The user provides a Linear issue link or identifier. Fetch the issue using Linear MCP tools.

**Do not assume the bug report is well-written.** Many bug reports are messy free-text, missing
key fields, or poorly structured. Your job is to extract everything you can — from the text,
the screenshots, and the comments — then fill remaining gaps with the user.

#### 1a. Fetch the issue and its comments

Call `get_issue` to read the issue, then **immediately** call `list_comments` in parallel.
Comments often contain critical context that the description lacks: reproduction details,
sample data, workaround notes, or follow-up screenshots from other team members.

#### 1b. Extract and study ALL screenshots

Bug reports often embed screenshots that contain information not written in the text — sample
data records, specific values (serial numbers, IDs, amounts), error messages, UI states, table
contents, highlighted rows. **This data is essential for writing accurate test steps.**

**Always call `extract_images` on the issue description.** If any comments also contain images,
call `extract_images` on those comment bodies too. Do this as part of your initial fetch — not
as an afterthought.

When viewing screenshots, look for:
- **Sample data visible in tables or lists** — specific record IDs, serial numbers, names, values
  that can be used as concrete test data in your test steps
- **Highlighted or annotated areas** — the reporter is pointing you to exactly what's wrong
- **UI state** — which page, which filters are applied, what's selected, what error is shown
- **Multiple records** — if the screenshot shows several affected rows, note all of them as
  potential test inputs (not just the first one you see)

**Video guard:** If the issue contains video links or attachments (`.mov`, `.mp4`, `.webm`,
`.avi`, `.mkv`), **do NOT attempt to download, play, or read the video in any way** — not
even if the user asks you to. Videos burn through context tokens and cannot be processed.
Instead:
1. Tell the user you found a video but cannot analyze it.
2. Ask them to provide either screenshots or a text description (or both) so you can proceed.

#### 1c. Parse the bug details

**Try to extract these fields from the text, screenshots, and comments combined:**

| Field | Where to look |
|-------|---------------|
| Environment | `### Environment` section, or mentions of "staging", "production", "dev" anywhere |
| Steps to reproduce | `### Steps to reproduce` section, or any numbered list / narrative of what happened |
| Expected result | `### Expected result` section, or phrases like "should have", "expected to" |
| Description | `### Description` section, or the first sentence/paragraph |
| Test link / URL | `Test link:` field, or any URL in the body |
| Test account | `Test account:` field, or email addresses mentioned |
| Platform | `Browser:` or `Device model:` fields, or context clues (mobile app, web app) |
| Sample test data | **Screenshots** — specific records, IDs, serial numbers, values visible in the UI |

**If the bug report is well-structured** (follows the `### Environment / ### Steps to reproduce /
### Expected result` template), parse it directly — but still check screenshots for sample data.

**If the bug report is unstructured or incomplete**, extract whatever you can from the prose,
screenshots, and comments combined, then ask the user to fill the gaps. Be specific about
what's missing.

Present what you found:

```
📋 Found issue: [TEAM-123] Title here
Team: [team] | Status: [status] | Labels: [labels]

Bug summary: [what went wrong, in your own words based on what you extracted]
Intended fix to verify: [what correct behavior should look like]

Data from screenshots: [any specific records, IDs, values extracted from images]
Data from comments: [any extra context found in comments]

⚠️ Missing: [list anything you couldn't find — steps, expected result, etc.]
```

**Essential fields to proceed:** You need at minimum (1) steps to reproduce and (2) expected
result. If either is missing, ask the user before continuing. Everything else is helpful but
you can work around it.

### Step 2: Gather SkyTest Context and Reuse Existing Configs

**First, establish the target project:**
1. Call `list_projects` to show the user their SkyTest projects
2. Let the user pick the project
3. Call `get_project` on the chosen project to retrieve **project-level configs**

**Reuse existing project configs wherever possible.** If the project already has `BASE_URL`,
`LOGIN_EMAIL`, `LOGIN_PASSWORD`, or other variables defined at the project level, do NOT
duplicate them as test-case-level variables. Only create test-case-level variables for values
that are specific to this test and not already in the project config.

Tell the user which project-level variables you'll be reusing: "Your project already has
BASE_URL and LOGIN_EMAIL configured — I'll reuse those."

**Check for existing regression tests:**
Call `list_test_cases` for the project. Scan names for anything that already covers the same
bug or flow (e.g., same `[Section]` prefix, similar description). If a match exists, tell the
user: "There's already a test case `[name]` that covers a similar flow. Want me to create a
new one anyway, or update the existing one?"

**Then gather what's still missing:**

| Need | Source |
|------|--------|
| Platform (browser / Android) | Infer from bug environment if clear, confirm with user |
| Base URL | From bug's test link or environment URL; skip if project config has it |
| Test credentials | Ask if the flow requires login and project doesn't have them |
| Android app ID | From bug context if mobile; skip if project config has it |

Batch all missing-info questions into one prompt.

If project-level variables are missing and the user provides values, use `manage_project_configs`
to store/reuse them (for example `BASE_URL`, `LOGIN_EMAIL`, `LOGIN_PASSWORD`, `APP_ID`) instead
of duplicating the same values across many test cases.

### Step 3: Understand Authentication and the User Flow

Before writing any test steps, establish the full user flow from entry point to the bug.

#### Authentication first

Most bug reports assume the user is already logged in. But every SkyTest test case must be
**self-contained** — it starts from the entry point (URL or app launch) and must handle
its own authentication. So before designing the regression steps:

- Does the flow require login? (Almost always yes.)
- What's the login page URL or entry point?
- What method? (email/password form, SSO, magic link, etc.)
- What credentials? (Reuse project-level `LOGIN_EMAIL` / `LOGIN_PASSWORD` if available.)

If auth is needed, the test case begins with login steps, followed by navigation to the
relevant page, then the regression-specific steps.

For Android targets, call `list_runner_inventory` and ask the user to choose a specific
connected device serial or emulator profile name before drafting the target selector.

#### Study the complete flow

Walk through the bug's steps mentally — from opening the app/page through to the expected
result. For each step, ask yourself: "Do I know exactly what the user sees and does here?"
and "Can I connect this step to the next one without gaps?"

If any step is vague, or if the flow has gaps where you can't connect one screen to the next
(e.g., "go to the settings page" — which settings? what button leads there? what does the
page look like?), stop and ask the user. Specifically:
- Ask a targeted question about what's unclear
- Request screenshots of the relevant screens if the flow is hard to follow from text alone
- Ask for a brief walkthrough if multiple screens or transitions are involved

Don't fill in gaps with assumptions — a test case with a wrong navigation step will fail
every time.

### Step 4: Design Regression Test Cases

Your default is **one regression test case per bug**. Only create more than one if the bug
report explicitly describes **multiple distinct issues** — for example, a bug that breaks
both the save action and the error message display. Don't invent extra coverage; one focused
test per bug is the right call.

#### The regression reframe

The bug's steps to reproduce describe what triggered the failure. Your test case uses the
same steps but reframed to verify the correct behavior. The final step asserts the **expected
result** from the bug report.

Example:
- Bug: "Click the checkout button → nothing happens"
- Test step: "Click the 'Checkout' button"
- Assertion step: "Verify the payment confirmation screen appears with the order total"

#### Test case structure

Every test case follows this order:
1. **Login steps** (if auth is required) — using `{{LOGIN_EMAIL}}` and `{{LOGIN_PASSWORD}}`
2. **Navigation steps** — get to the page/screen where the bug occurs
3. **Reproduction steps** — the actions from the bug's steps to reproduce
4. **Assertion steps** — verify the expected result (the bug is fixed)

#### Only add more test cases if the bug covers multiple distinct issues

If the bug description identifies two or more separate broken behaviors, create one test case
per issue. Keep each focused. Never add test cases for hypothetical edge cases not in the bug.

#### Test case ID

Derive the `testCaseId` from the Linear issue ID:
- Linear `SKY-234` → SkyTest `REG-SKY-234`
- Linear `TEAM-456` → SkyTest `REG-TEAM-456`

If the bug has multiple distinct issues, append a suffix: `REG-SKY-234-A`, `REG-SKY-234-B`.

#### Priority classification

| Bug label | Test priority |
|-----------|-------------|
| `bug/critical` or `bug/major` | P0 |
| `bug/minor` or `ui/major` | P1 |
| `bug/trivial` or `ui/minor` | P2 |

### Step 5: Present Test Cases for Confirmation

Present one test case at a time:

```
🧪 Test Case [N of total]: [Section] Short description
ID: REG-TEAM-123
Priority: P0 / P1 / P2
Platform: Browser / Android

Steps:
1. Navigate to {{BASE_URL}}/login
2. Fill in email with {{LOGIN_EMAIL}} and password with {{LOGIN_PASSWORD}}, click Sign In
3. [navigation to relevant page]
4. [reproduction steps from bug]
...
N. Verify [expected result from bug]

New variables (test-case level):
- SOME_VALUE: [value]

Reusing from project config:
- BASE_URL, LOGIN_EMAIL, LOGIN_PASSWORD

Target: Browser (1920×1080) / Android ([device name])

Shall I create this? (yes / modify / skip)
```

Wait for explicit confirmation. If the user says "modify", take their changes and re-present.

### Step 6: Create the Test Cases

#### Pre-flight checklist

Before each `create_test_case` call, verify:
- [ ] Single `testCase` object (never batch)
- [ ] `name` follows `[Section] Short description` format
- [ ] `testCaseId` is set (e.g., `REG-SKY-234`)
- [ ] Target IDs used consistently in every step's `target` field
- [ ] All `{{VAR}}` references have matching variables (either test-case-level or project-level)
- [ ] Step `type` set correctly (default `ai-action`)
- [ ] Passwords use `masked: true` and empty `value`
- [ ] No `FILE` variables in payload
- [ ] Only test-case-specific variables included (not duplicating project-level configs)

#### Browser example

```json
{
  "projectId": "<confirmed project ID>",
  "testCase": {
    "name": "[Checkout] Verify checkout button responds after fix",
    "testCaseId": "REG-SKY-234",
    "browserTargets": [
      { "id": "browser_a", "name": "Primary Browser", "url": "{{BASE_URL}}", "width": 1920, "height": 1080 }
    ],
    "steps": [
      { "id": "step_1", "target": "browser_a", "action": "Navigate to the login page", "type": "ai-action" },
      { "id": "step_2", "target": "browser_a", "action": "Fill in the 'Email' field with '{{LOGIN_EMAIL}}' and the 'Password' field with '{{LOGIN_PASSWORD}}', then click the 'Sign In' button", "type": "ai-action" },
      { "id": "step_3", "target": "browser_a", "action": "Navigate to the checkout page by clicking 'Cart' in the top navigation", "type": "ai-action" },
      { "id": "step_4", "target": "browser_a", "action": "Click the 'Checkout' button", "type": "ai-action" },
      { "id": "step_5", "target": "browser_a", "action": "Verify the payment confirmation screen appears displaying the order total and a 'Confirm Payment' button", "type": "ai-action" }
    ],
    "variables": [
      { "name": "CART_ITEM", "type": "VARIABLE", "value": "Test Product A" }
    ]
  }
}
```

Note: `BASE_URL`, `LOGIN_EMAIL`, `LOGIN_PASSWORD` are not in `variables` because they already
exist at the project level. Only `CART_ITEM` is new and specific to this test.

#### Android example

```json
{
  "projectId": "<confirmed project ID>",
  "testCase": {
    "name": "[Auth] Verify Google SSO login on Android after fix",
    "testCaseId": "REG-SKY-102",
    "androidTargets": [
      {
        "id": "android_a",
        "name": "Pixel 8",
        "device": "Pixel 8",
        "appId": "{{APP_ID}}",
        "clearAppState": true,
        "allowAllPermissions": true
      }
    ],
    "steps": [
      { "id": "step_1", "target": "android_a", "action": "Tap the 'Continue with Google' button on the login screen", "type": "ai-action" },
      { "id": "step_2", "target": "android_a", "action": "Select the test Google account '{{GOOGLE_ACCOUNT}}'", "type": "ai-action" },
      { "id": "step_3", "target": "android_a", "action": "Verify the home screen loads and displays the user's profile name in the top bar", "type": "ai-action" }
    ],
    "variables": [
      { "name": "APP_ID", "type": "APP_ID", "value": "com.example.app" },
      { "name": "GOOGLE_ACCOUNT", "type": "VARIABLE", "value": "test@gmail.com" }
    ]
  }
}
```

#### Step writing rules

- Use natural language referencing visible UI elements by their labels
- Batch related sub-actions into one step (fill multiple fields at once)
- Prefix assertion steps with: Verify / Assert / Check / Confirm / Ensure / Validate
- Use `{{VARIABLE}}` for all configurable values — never hardcode credentials or URLs
- Each step must reference a target ID defined in the targets array

#### Assertion depth

Verify *consequences*, not just appearance:
- After button click → verify the resulting page or state, not just that the button was clicked
- After form submit → verify data is reflected on a detail page, not just that the form closed
- After login → verify user identity shown in header, not just URL changed
- After error fix → verify the correct behavior matches the bug's expected result exactly

After creating, share the test case ID with the user.

If the user wants immediate verification, run the case via `run_test_case` and use
`list_test_runs` with `include: ["events", "artifacts"]` to summarize pass/fail evidence.

### Step 7: Final Summary

After all cases are processed, summarize:
- Created cases listed by priority (P0/P1/P2)
- Reused project variables
- Skipped cases and reasons
- Coverage gaps and recommended next tests

## Field Mapping Reference

| Linear Bug Field | SkyTest Test Case Field |
|---|---|
| Issue ID (e.g., `SKY-234`) | `testCaseId`: `REG-SKY-234` |
| `[Section]` in title | `[Section]` prefix in test case name |
| Steps to Reproduce | `steps` array (reframed as regression verification) |
| Expected Result | Final assertion step |
| Test link / Environment URL | `BASE_URL` variable (or reuse from project) |
| Test account email | `LOGIN_EMAIL` variable (or reuse from project) |
| Test account password | `LOGIN_PASSWORD` variable, masked (or reuse from project) |
| Browser field | Browser target config |
| Device model & OS | Android target config |
| `bug/critical` or `bug/major` label | P0 priority |
| `bug/minor` or `ui/major` label | P1 priority |
| `bug/trivial` or `ui/minor` label | P2 priority |

## Error Handling

- **Issue not found**: Tell the user and ask for the correct link or ID.
- **Messy / unstructured bug report**: Extract what you can, clearly list what's missing, ask the user to fill gaps.
- **No steps to reproduce**: Ask the user — don't guess.
- **No expected result**: Ask what correct behavior should look like.
- **Ambiguous UI step**: Ask a targeted question — e.g., "Does clicking X open a modal or navigate to a new page?"
- **Missing test credentials**: Ask explicitly; note that passwords will be stored masked.
- **Duplicate test case exists**: Tell the user and ask whether to create a new one or update the existing one.
- **Project config conflict**: If a variable name collides with a project-level config, inform the user which project variable is being reused.
- **Test creation fails**: Show the MCP error and offer to retry.

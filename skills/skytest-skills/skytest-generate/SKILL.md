---
name: skytest-generate
description: Generate and maintain SkyTest test cases from feature descriptions, screenshots, or user flow documentation. Creates draft test cases with complete steps, targets, and variables. Supports MCP create/update, direct run trigger, run querying, project config management, inventory lookup, stop-all runs/queues, and delete. Use when the user asks to generate, create, update, run, or manage test cases for a feature or user flow.
---

# SkyTest Generate Skill

Design high-quality, context-driven test coverage and execute MCP operations safely.

## Non-Negotiable Rules

- Never create or update multiple test cases in one call.
- Always confirm with the user before each create, update, delete or run operation.
- Never guess a UI step — if any step is unclear, ask the user for screenshots or a walkthrough.
- Do not send `FILE` variables through MCP create. SkyTest does not support file attachments — skip file-type configs entirely.
- `stop_all_runs` cancels everything active. `stop_all_queues` cancels only queued items.
- For every create or update that sets a test case `name`, enforce format: `[Section] Short description` (example: `[Auth] Login Happy Path`).
- For every new test case, assign a `testCaseId` following the user's preferred convention. **Ask the user for their ID pattern** if not already established. The default format is `XXXXX-NNN`: exactly 5 uppercase letters derived semantically from the section or feature name, a hyphen, and a 3-digit zero-padded sequence number (e.g., `LOGIN-001`, `PAYMT-002`, `REGIS-001`). But users may prefer different patterns such as hierarchical IDs (`CMS-02-001`, `APP-03-001`). Once the user establishes a pattern, follow it exactly for all subsequent test cases. 
- **Never attempt to read, download, or process video files** (`.mov`, `.mp4`, `.webm`, `.avi`, `.mkv`) — not even if the user asks. Videos burn through context tokens and cannot be processed. Ask for screenshots or text descriptions instead.
- **Never force a test case that can't be fully automated.** If a step requires something outside SkyTest's capabilities, flag it honestly and suggest manual testing (see "Automation Boundaries" below).

## Automation Boundaries

SkyTest can only automate what happens inside a **clean browser session** or an **installed Android APK**. It executes explicit UI instructions step by step — nothing more.

**If any step in a flow requires actions outside the browser or APK, that step cannot be automated.** Common examples:

- Checking email (e.g., email verification, password reset links)
- Receiving or entering email OTP / SMS codes
- Interacting with third-party auth popups that leave the app's domain (e.g., bank 3DS, OAuth to external provider)
- Third-party payment flows (e.g., Stripe checkout, PayPal redirect, Apple Pay / Google Pay sheets)
- Controlling external hardware or devices (e.g., printers, scanners, Bluetooth)
- Verifying push notifications outside the app
- File system operations on the user's machine (e.g., verifying a downloaded file's contents)
- Backend-only validation (e.g., checking database records, API responses, logs)
- Waiting for async processes that have no visible UI indicator (e.g., background jobs, webhooks)

**When you encounter these:**
1. Do NOT try to create a test case that includes the un-automatable step — it will fail every run.
2. Tell the user clearly: "This step requires [email/OTP/etc.] which SkyTest can't automate."
3. Suggest splitting the flow: automate what you can (everything before and after the manual step), and recommend the user test the un-automatable part manually.
4. If an entire scenario is un-automatable, skip it and note it as "recommended for manual testing" in the final report.

## MCP Operations

| Tool | Purpose |
|------|---------|
| `list_projects` | List user's projects |
| `get_project` | Project details + project-level configs |
| `list_test_cases` | List test cases (optional status filter) |
| `get_test_case` | Full case: steps, configs, last 5 runs |
| `create_test_case` | Create exactly one test case per call |
| `update_test_case` | Update one test case per call |
| `run_test_case` | Queue one run for a test case with optional overrides |
| `list_test_runs` | List runs with filters and optional events/artifacts |
| `delete_test_case` | Delete a test case and all related data |
| `manage_project_configs` | Upsert/remove project-level configs in one call |
| `list_runner_inventory` | List runner/device inventory and Android selector options |
| `stop_all_runs` | Cancel QUEUED + PREPARING + RUNNING runs |
| `stop_all_queues` | Cancel QUEUED runs only |
| `get_test_run` | Run status and result |
| `get_project_test_summary` | Status breakdown across test cases |

## Workflow

### 1. Gather Context

Collect from the user:
- Feature scope and user flows
- Target project (use `list_projects` to show options)
- Platform: browser, Android, or both

**Required identifiers — do not proceed without these:**
- Browser flow requires the **base URL** (e.g., `https://myapp.com`)
- Android flow requires the **Android app ID** (e.g., `com.example.app`)

For Android flows, call `list_runner_inventory` before drafting targets. Present available
connected devices and emulator profiles to the user, then confirm which selector to use.

**Reuse existing project configs.** Call `get_project` on the chosen project to retrieve
project-level variables. If `BASE_URL`, `LOGIN_EMAIL`, `LOGIN_PASSWORD`, or other variables
already exist at the project level, do NOT duplicate them as test-case-level variables. Only
create test-case-level variables for values specific to a particular test case. Tell the user
which project-level variables you'll be reusing: "Your project already has BASE_URL and
LOGIN_EMAIL configured — I'll reuse those."

**Check for existing test coverage.** Call `list_test_cases` for the project. Scan names for
anything that already covers the same feature or flow. If coverage exists, tell the user:
"There are already test cases covering [related area]. Want me to complement them, or start
fresh?"

### 2. Understand Flows Before Writing Tests

The goal: produce a complete, step-by-step walkthrough of every flow with zero gaps.

#### 2a. Understand Authentication First

Before studying any feature flow, always establish:
- How does the user log in? (form, SSO, API key, magic link)
- What is the login URL or entry point?
- Are there multiple roles? Which role is needed?
- What test credentials will be used?

Ask the user to provide credentials. These become `VARIABLE` configs (`masked: true` for passwords).
Reuse project-level `LOGIN_EMAIL` / `LOGIN_PASSWORD` if available.

**Check for existing login test steps.** If the user mentions that the project already has a login case (e.g., LOGIN-001) for the same role, use those steps as a baseline, then verify selectors and entry path still match the current flow before reuse.

#### 2b. Understand Business Context

Establish:
- What domain is this product in?
- Who are the target users?
- What are the core business workflows?
- Which flows affect revenue, security, or compliance?

This context drives your test data choices — use realistic values from the actual domain rather
than generic placeholders.

#### 2c. Study the Flow and Fill Gaps

For each step, ask: "Do I know exactly what the user sees and does here?" and "Can I connect
this step to the next one without gaps?"

If NO for any step, or if you can't connect one screen to the next:
1. Ask a targeted question about what's unclear
2. Request screenshots of the relevant screens if the flow is hard to follow from text alone
3. Ask for a brief walkthrough if multiple screens or transitions are involved

When the user provides screenshots, study them carefully — extract specific button labels, field
names, navigation paths, table columns, and any visible data that can inform your test steps.

**A flow with any unclear step is not ready to present.** Don't fill in gaps with assumptions —
a test case with a wrong navigation step will fail every time.

#### 2d. Present and Confirm Flows

Present flows as structured step-by-step lists. Each step: exactly what the user does and sees — specific button labels, field names, page transitions.

```
**Flow 1: Email/Password Login**
1. Navigate to /login — page shows email and password fields and a "Sign In" button
2. Enter email in the "Email address" field
3. Enter password in the "Password" field
4. Click the "Sign In" button
5. Redirected to /dashboard — page shows the "Welcome back" heading
```

Ask: Are these correct? Any missing flows? Any to skip?

**Do NOT proceed until the user explicitly confirms.**

### 3. Design Test Cases with Risk-Based Prioritization

#### 3a. Classify Flows by Business Risk

- **P0 — Revenue / Security / Compliance**: Payments, authentication, authorization, personal data. Failure = business loss or legal exposure.
- **P1 — Core User Journeys**: Primary daily workflows. Failure = users blocked.
- **P2 — Error Handling & Edge Cases**: Validation, error recovery, boundary conditions. Failure = degraded experience.
- **P3 — Polish & Rare Scenarios**: Unusual inputs, cosmetic issues, rare configurations.

Present the classification. Design cases starting from P0 downward.

#### 3b. Apply Structured Test Design

For each flow:
- **Happy path**: Standard successful flow as confirmed in Step 2
- **Input validation**: Invalid, empty, boundary-length, and special-character inputs per field
- **Business rule enforcement**: Constraints the system must enforce (empty cart, duplicate entries, required fields)
- **State transitions**: Back button, page refresh, double-click submit, session expiry mid-flow
- **Error recovery**: User triggers error, corrects input, completes flow without restarting
- **Authorization boundaries**: Users cannot access resources beyond their role (if roles exist)

**Before designing each test case, check: can every step be fully automated inside the browser
or APK?** If a flow involves email, OTP, third-party payment, or any un-automatable step, flag
it immediately. Don't design a test case you know will fail — suggest manual testing instead.

#### 3c. Ensure Test Independence

Every test case must be self-contained:
- Starts from entry point (URL or app launch)
- Includes its own login steps if needed
- Does not depend on another test case having run
- Notes any preconditions requiring manual data setup

### 4. Review and Create One Case at a Time

For each candidate:
1. Present exactly ONE test case (`name` must be `[Section] Short description`), plus priority, steps, assertions, configs, and targets
2. Show which project-level variables are being reused and which new test-case-level variables are needed
3. Ask: confirm/create, modify, or skip
4. Create only after explicit confirmation via `create_test_case`
5. If modified, revise and re-present
6. If skipped, move to next

### 5. Update Existing Test Cases

Use `update_test_case` with one test case ID per call. Updatable fields: `name`, `url`, `prompt`, `steps`, `browserConfig`, `configs`/`variables`, `removeConfigNames`/`removeVariableNames`.

If `name` is provided in an update, keep format `[Section] Short description`.

If active runs exist, include `activeRunResolution`:
- `cancel_and_save` — cancel runs and save changes as DRAFT
- `do_not_save` — keep active runs, skip saving

### 6. Stop Runs/Queues

- `stop_all_runs` — cancels QUEUED + PREPARING + RUNNING
- `stop_all_queues` — cancels QUEUED only
- Both require `projectId`

### 7. Run and Diagnose

- Trigger execution with `run_test_case` only after an explicit run confirmation (separate from create/update confirmation).
- Use `list_test_runs` with `include: ["events", "artifacts"]` to monitor failures and collect evidence.
- For repeated environment variable changes (e.g., base URL or credentials), use
  `manage_project_configs` instead of duplicating per-test-case variables.

## Step Writing Rules

Steps default to `type: "ai-action"` — natural language executed by Midscene AI.

Use `type: "playwright-code"` when the step needs precise, deterministic interaction that AI might interpret ambiguously. Common cases where playwright-code is preferred:
- **Login flows** — credential filling and multi-step auth sequences that stay inside the same app/browser session (excluding email/SMS OTP retrieval)
- **Navigation** — sidebar menus, hierarchical menu clicks, tab switching where labels may be ambiguous
- **Dropdown selection** — selecting specific options from `<select>` elements
- **Any step the user provides explicit Playwright code for**

**For ai-action steps:**
- Use natural language describing visible UI elements by their labels
- Batch related sub-actions into single steps (fill multiple fields in one step)
- Prefix verification steps with Verify/Assert/Check/Confirm/Ensure/Validate
- Use `{{VARIABLE}}` for all configurable values
- Each step targets a specific browser/Android target ID

**For playwright-code steps:**
- Access project/test-case variables via `vars["VARIABLE_NAME"]`
- Use Playwright's recommended locators: `getByRole`, `getByText`, `getByLabel`, `locator('css-selector')`

**Anti-patterns — never do these:**
- Vague assertions: "Verify the page looks correct" — specify what should be visible
- Assuming invisible state: "Wait for the API to respond" — instead verify visible UI change
- Over-granular steps: separate step for each form field — combine into one fill step
- Hardcoded values that should be variables: `john@test.com` in step text — use `{{LOGIN_EMAIL}}`
- Using `page.goto()` for in-app navigation — always click through the UI instead
- Combining verify + action + verify in one ai-action step — see "Atomic Step Principle" below
- Using playwright-code for scrolling — use ai-action instead (e.g., "Scroll to the bottom of the page", "Scroll down 500px")

### Atomic Step Principle

Each ai-action step reasons about the current page state once. It cannot track state changes mid-step. Therefore: **never combine verify + action + verify in a single ai-action step.**

Bad: `"Verify Cancel and Submit buttons are visible, click Cancel, then verify the list page appears"`

Split into atomic steps:
1. `Verify Cancel and Submit buttons are visible` (ai-action)
2. `Click the Cancel button` (ai-action)
3. `Verify the list page is displayed` (ai-action)

### Viewport and Scroll Awareness

Long forms, permission matrices, and large tables often extend below the viewport. The AI can only see and interact with elements currently on screen.

**Plan scroll steps proactively** when a page has 8+ fields, a checkbox matrix, or action buttons at the bottom. Use ai-action for scrolling (e.g., `"Scroll to the bottom of the page"`), never playwright-code.

**Split verifications around scroll:** verify above-fold content → scroll down → verify below-fold content. Asserting below-fold elements before scrolling will fail.

### Navigation by Clicking

**Never use `page.goto()` for in-app navigation.** Click through the UI like a real user.

For hierarchical menus (sidebar with parent → child), click parent first, then child. Use playwright-code for navigation when labels are ambiguous — AI sidebar clicks can land on the wrong page.

```javascript
// Sidebar navigation pattern (playwright-code)
await page.getByText('Parent Menu', { exact: true }).click();
await page.getByRole('link', { name: 'Sub Page' }).click();
```

Establish navigation code once per menu path and reuse it across all cases targeting the same page. If navigation fails, ask the user for correct code — don't guess selectors.

## Assertion Depth

Verify *consequences*, not just appearance:
- **After create**: Item appears in list/table, not just success toast
- **After delete**: Item gone from list, not just confirmation dismissed
- **After form submit**: Data reflected on detail page, not just form closed
- **After login**: User identity shown in header, not just URL changed
- **After error**: Specific error message displayed, previously entered data preserved

**Exact vs generic assertions — match the user's intent:**
- When the user asks to assert specific values (e.g., "check the exact data on screen"), extract and hardcode the actual text from screenshots or user-provided data. The AI needs concrete text to match — never write vague descriptions like "displays the correct value".
- When the user wants to verify dynamic or generic data display (e.g., "check the table has data", "verify fields are populated"), assert presence, format, or pattern instead of exact values.
- Static UI elements (labels, titles, headers, field names) — always assert exact text.
- Static data the user explicitly wants checked (creation dates, IDs, specific records) — assert exact values.
- Dynamic content that changes each session (login timestamps, last-updated times, row counts) — assert presence or format only.
- When unsure whether to assert exact values or just presence, ask the user.

**Form default states:** When verifying add/create forms, check actual defaults from screenshots. Don't assume all checkboxes are unchecked — some may be pre-checked by default. Assert what you see, not what you assume.

## Context-Driven Test Data

Test data should come from the user's actual context — not from generic templates.

**Where to get test data:**
- Screenshots provided by the user — extract specific records, IDs, values visible in the UI
- Feature descriptions — use actual field names, entity types, and business terms from the requirement
- Existing project configs — reuse variables that already contain real test data
- The user directly — ask for realistic values they use in their environment

**Use realistic domain-appropriate data when no context is available:**
- E-commerce: real product names, prices, addresses
- Healthcare: patient IDs, appointment types
- Fintech: account numbers, transaction amounts
- SaaS: workspace names, team roles

Never use "test123", "foo@bar.com", or "Lorem ipsum". For error paths, use realistic invalid inputs (typos, too-short passwords, text in number fields).

## Config Rules

- Names: `UPPER_SNAKE_CASE`
- `VARIABLE` type for credentials (`masked: true` for passwords)
- `URL` type for base URLs
- `RANDOM_STRING` for unique test data per run
- `APP_ID` type for Android app identifiers
- `FILE` type excluded — SkyTest does not support file attachments. Skip file-type configs entirely.
- Only include test-case-level variables for values NOT already in the project config

## Target Config Defaults

- Browser: `{ url: "...", width: 1920, height: 1080 }`
- Android: `{ type: "android", deviceSelector: {...}, appId: "...", clearAppState: true, allowAllPermissions: true }`
- Default to browser unless user specifies Android

### Android Device Resolution

Pass the device name the user provides in the `device` field (e.g., `"Pixel 8"`, `"Medium Phone"`). The server resolves it against the device inventory using profile names, display names, and connected device labels.

If the server response includes a warning that the device was not found in inventory, **stop and confirm with the user** before running the test. Ask which device to use — do not silently proceed with an unresolved device name.

When inventory is available, prefer explicit selectors from `list_runner_inventory`:
- Connected device selector: `{ mode: "connected-device", serial: "<serial>" }`
- Emulator profile selector: `{ mode: "emulator-profile", emulatorProfileName: "<profile>" }`

## Create Call Checklist

Before each `create_test_case` call, verify:
- [ ] Single `testCase` object (never batch)
- [ ] `name` follows `[Section] Short description` format
- [ ] `testCaseId` follows the user's established ID convention (default: `XXXXX-NNN`)
- [ ] Target IDs used consistently in every step's `target` field
- [ ] Complete target definitions for all referenced targets
- [ ] All `{{VAR}}` references have matching variables (test-case-level or project-level)
- [ ] Step `type` set correctly (`ai-action` or `playwright-code`)
- [ ] No `FILE` variable in payload
- [ ] Only test-case-specific variables included (not duplicating project-level configs)

If the server skips a variable due to matching project config, inform the user which project variable is being reused.

## Example: Complete Create Call

```json
{
  "projectId": "proj_123",
  "testCase": {
    "name": "[Auth] Login Happy Path",
    "testCaseId": "LOGIN-001",
    "browserTargets": [
      {
        "id": "browser_a",
        "name": "Primary Browser",
        "url": "https://myapp.com/login",
        "width": 1920,
        "height": 1080
      }
    ],
    "steps": [
      {
        "id": "step_1",
        "target": "browser_a",
        "action": "Fill in the 'Email address' field with '{{LOGIN_EMAIL}}' and the 'Password' field with '{{LOGIN_PASSWORD}}'",
        "type": "ai-action"
      },
      {
        "id": "step_2",
        "target": "browser_a",
        "action": "Click the 'Sign In' button",
        "type": "ai-action"
      },
      {
        "id": "step_3",
        "target": "browser_a",
        "action": "Verify the page displays the 'Dashboard' heading and the user's email '{{LOGIN_EMAIL}}' appears in the top navigation bar",
        "type": "ai-action"
      }
    ],
    "variables": [
      { "name": "LOGIN_EMAIL", "type": "VARIABLE", "value": "john.smith@company.com" },
      { "name": "LOGIN_PASSWORD", "type": "VARIABLE", "value": "Abcd1234!", "masked": true }
    ]
  }
}
```

## Final Report

After iterating through all cases, summarize:
- Created cases by priority (P0/P1/P2/P3)
- Reused project variables
- Updated cases and fields changed
- Skipped cases and reasons (including any flagged for manual testing due to automation boundaries)
- Stop/delete actions executed
- Coverage gaps and recommended next tests

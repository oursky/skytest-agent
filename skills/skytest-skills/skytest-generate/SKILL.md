---
name: skytest-generate
description: Generate and maintain SkyTest test cases from feature descriptions, screenshots, or user flow documentation. Creates draft test cases with complete steps, targets, and variables. Supports MCP create (single-create mode), update (one test case per call), stop-all runs/queues, and delete. Use when the user asks to generate, create, update, or manage test cases for a feature or user flow.
---

# SkyTest Generate Skill

Design high-quality test coverage and execute MCP operations safely.

## MCP Operations

| Tool | Purpose |
|------|---------|
| `list_projects` | List user's projects |
| `get_project` | Project details + project-level configs |
| `list_test_cases` | List test cases (optional status filter) |
| `get_test_case` | Full case: steps, configs, last 5 runs |
| `create_test_case` | Create exactly one test case per call |
| `update_test_case` | Update one test case per call |
| `delete_test_case` | Delete a test case and all related data |
| `stop_all_runs` | Cancel QUEUED + PREPARING + RUNNING runs |
| `stop_all_queues` | Cancel QUEUED runs only |
| `get_test_run` | Run status and result |
| `get_project_test_summary` | Status breakdown across test cases |

## Non-Negotiable Rules

- Never create or update multiple test cases in one call.
- Always confirm with the user before each create or update.
- Never guess a UI step — if any step is unclear, ask the user or request live browser exploration.
- Do not send `FILE` variables through MCP create. Tell the user to upload files in SkyTest UI afterward.
- `stop_all_runs` cancels everything active. `stop_all_queues` cancels only queued items.
- For every create or update that sets a test case `name`, enforce format: `[Section] Short description` (example: `[CanOutage] Screen Load & Display`).

## Workflow

### 1. Gather Context

Collect from the user:
- Feature scope and user flows
- Target project (use `list_projects` to show options)
- Platform: browser, Android, or both

**Required identifiers — do not proceed without these:**
- Browser flow requires the **base URL** (e.g., `https://myapp.com`)
- Android flow requires the **Android app ID** (e.g., `com.example.app`)

Use `get_project` to check existing project-level configs and reuse them.

### 2. Understand Flows Before Writing Tests

The goal: produce a complete, step-by-step walkthrough of every flow with zero gaps.

#### 2a. Understand Authentication First

Before studying any feature flow, always establish:
- How does the user log in? (form, SSO, API key, magic link)
- What is the login URL or entry point?
- Are there multiple roles? Which role is needed?
- What test credentials will be used?

Ask the user to provide credentials. These become `VARIABLE` configs (`masked: true` for passwords).

#### 2b. Understand Business Context

Establish:
- What domain is this product in?
- Who are the target users?
- What are the core business workflows?
- Which flows affect revenue, security, or compliance?

#### 2c. Explore the App If Needed

For each step, ask: "Do I know exactly what the user sees and does here?"

If NO for any step — ask the user to either:
1. Connect a browser agent for live exploration, or
2. Answer targeted questions to fill the gap

**A flow with any unclear step is not ready to present.**

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

#### 3c. Ensure Test Independence

Every test case must be self-contained:
- Starts from entry point (URL or app launch)
- Includes its own login steps if needed
- Does not depend on another test case having run
- Notes any preconditions requiring manual data setup

### 4. Review and Create One Case at a Time

For each candidate:
1. Present exactly ONE test case (`name` must be `[Section] Short description`), plus priority, steps, assertions, configs, and targets
2. Ask: confirm/create, modify, or skip
3. Create only after explicit confirmation via `create_test_case`
4. If modified, revise and re-present
5. If skipped, move to next

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

## Step Writing Rules

Steps default to `type: "ai-action"` — natural language executed by Midscene AI.

Use `type: "playwright-code"` only when the user explicitly requests a code step and provides the Playwright code. The `action` field then contains the Playwright script instead of natural language.

**For ai-action steps:**
- Use natural language describing visible UI elements by their labels
- Batch related sub-actions into single steps (fill multiple fields in one step)
- Prefix verification steps with Verify/Assert/Check/Confirm/Ensure/Validate
- Use `{{VARIABLE}}` for all configurable values
- Each step targets a specific browser/Android target ID

**Anti-patterns — never do these:**
- Vague assertions: "Verify the page looks correct" — specify what should be visible
- Assuming invisible state: "Wait for the API to respond" — instead verify visible UI change
- Over-granular steps: separate step for each form field — combine into one fill step
- Hardcoded values that should be variables: `john@test.com` in step text — use `{{LOGIN_EMAIL}}`

## Assertion Depth

Verify *consequences*, not just appearance:
- **After create**: Item appears in list/table, not just success toast
- **After delete**: Item gone from list, not just confirmation dismissed
- **After form submit**: Data reflected on detail page, not just form closed
- **After login**: User identity shown in header, not just URL changed
- **After error**: Specific error message displayed, previously entered data preserved

**Static vs dynamic assertions:**
- Static UI (labels, titles, headers) — assert exact text
- Dynamic content (user data, timestamps, counts) — assert presence or pattern

## Test Data Rules

Use realistic domain-appropriate data:
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
- `FILE` type excluded from MCP create — tell user to upload afterward

## Target Config Defaults

- Browser: `{ url: "...", width: 1920, height: 1080 }`
- Android: `{ type: "android", deviceSelector: {...}, appId: "...", clearAppState: true, allowAllPermissions: true }`
- Default to browser unless user specifies Android

### Android Device Resolution

Pass the device name the user provides in the `device` field (e.g., `"Pixel 8"`, `"Medium Phone"`). The server resolves it against the device inventory using profile names, display names, and connected device labels.

If the server response includes a warning that the device was not found in inventory, **stop and confirm with the user** before running the test. Ask which device to use — do not silently proceed with an unresolved device name.

## Create Call Checklist

Before each `create_test_case` call, verify:
- [ ] Single `testCase` object (never batch)
- [ ] Target IDs used consistently in every step's `target` field
- [ ] Complete target definitions for all referenced targets
- [ ] All `{{VAR}}` references have matching variables (masked passwords use `value: ""`)
- [ ] Step `type` set correctly (`ai-action` or `playwright-code`)
- [ ] No `FILE` variable in payload

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
      { "name": "LOGIN_PASSWORD", "type": "VARIABLE", "value": "", "masked": true }
    ]
  }
}
```

## Final Report

After iterating through all cases, summarize:
- Created cases by priority (P0/P1/P2/P3)
- Updated cases and fields changed
- Skipped cases and reasons
- Stop/delete actions executed
- Coverage gaps and recommended next tests

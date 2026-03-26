---
name: skytest-3-tools
description: >
  Execute SkyTest MCP operations: create, update, delete, and run test cases.
  Takes a test plan from skytest-2-plan and translates it into MCP API calls
  with proper payloads, configs, and targets. Also handles project config
  management, runner inventory, run monitoring, and stop operations. Use when
  the user has confirmed test cases and wants to create them in SkyTest, or
  needs to manage existing test cases and runs directly.
---

# SkyTest Tools Skill

Translate confirmed test plans into SkyTest MCP operations and manage test cases.

## Non-Negotiable Rules

- **Never create or update multiple test cases in one call.** One `create_test_case` or `update_test_case` call = one test case.
- **Always confirm with the user before each create, update, delete, or run operation.**
- **Do not send `FILE` variables through MCP.** SkyTest does not support file attachments via MCP — skip file-type configs entirely.
- **For every create or update that sets a test case `name`**, enforce format: `[Section] Short description` (e.g., `[Auth] Login Happy Path`).
- **For every new test case, use a `testCaseId`** following the user's established convention. Default: `XXXXX-NNN` (5 uppercase letters + hyphen + 3-digit zero-padded number). Ask the user if not established.
- **Never attempt to read, download, or process video files.**
- `stop_all_runs` cancels everything active (QUEUED + PREPARING + RUNNING). `stop_all_queues` cancels only QUEUED items.

## MCP Operations

| Tool | Purpose |
|------|---------|
| `list_projects` | List user's projects |
| `get_project` | Project details + project-level configs |
| `get_project_test_summary` | Status breakdown across test cases |
| `list_test_cases` | List test cases (optional status filter) |
| `get_test_case` | Full case: steps, configs, last 5 runs |
| `create_test_case` | Create exactly one test case per call |
| `update_test_case` | Update one test case per call |
| `delete_test_case` | Delete a test case and all related data |
| `run_test_case` | Queue one run with optional overrides |
| `list_test_runs` | List runs with filters and optional events/artifacts |
| `get_test_run` | Run status and result |
| `manage_project_configs` | Upsert/remove project-level configs in one call |
| `list_runner_inventory` | List runner/device inventory and Android selector options |
| `stop_all_runs` | Cancel QUEUED + PREPARING + RUNNING runs |
| `stop_all_queues` | Cancel QUEUED runs only |

## Input

Expects a **confirmed test plan** from `/skytest-2-plan`. The plan provides:
- Test case names, IDs, priorities
- Step-by-step flows with step type hints
- Variables needed (test-case level) and project-level reuse notes
- Target platform (browser or Android)

If the user doesn't have a test plan, accept direct instructions for individual operations (create, update, run, delete, etc.). For best coverage quality, recommend running `/skytest-1-explore` then `/skytest-2-plan` first.

## Workflow

### 1. Gather Project Context

Before creating any test cases:

1. **List projects** — call `list_projects` and let the user pick the target project
2. **Get project details** — call `get_project` to retrieve project-level configs
3. **Identify reusable variables** — if `BASE_URL`, `LOGIN_EMAIL`, `LOGIN_PASSWORD`, or other variables already exist at the project level, do NOT duplicate them as test-case-level variables. Tell the user: "Your project already has [variables] configured — I'll reuse those."
4. **Check existing coverage** — call `list_test_cases` for the project. If cases already cover the same feature/flow, tell the user: "There are already test cases covering [area]. Want me to complement them, or start fresh?"
5. **For Android flows** — call `list_runner_inventory` before drafting targets. Present available connected devices and emulator profiles, then confirm which selector to use.

### 2. Create Test Cases One at a Time

For each test case from the plan (or from user instructions):

1. **Present** exactly one test case: name, ID, priority, steps, assertions, configs, and targets
2. **Show** which project-level variables are being reused and which new test-case-level variables are needed
3. **Ask:** confirm/create, modify, or skip
4. **Create** only after explicit confirmation via `create_test_case`
5. If modified, revise and re-present before creating
6. If skipped, move to the next case

### 3. Update Existing Test Cases

Use `update_test_case` with one test case ID per call.

**Updatable fields:** `name`, `url`, `prompt`, `steps`, `browserConfig`, `configs`/`variables`, `removeConfigNames`/`removeVariableNames`.

If `name` is provided in an update, enforce `[Section] Short description` format.

If active runs exist, include `activeRunResolution`:
- `cancel_and_save` — cancel runs and save changes (test case becomes DRAFT)
- `do_not_save` — keep active runs, skip saving

### 4. Delete Test Cases

Use `delete_test_case` with confirmation. Deletion removes the test case and all related data (runs, files, configs). This is irreversible.

### 5. Run and Monitor

- **Queue a run** with `run_test_case` only after explicit run confirmation (separate from create/update confirmation).
- **Override at runtime** — `run_test_case` accepts optional overrides: `url`, `prompt`, `steps`, `browserConfig`, `requestedDeviceId`, `requestedRunnerId`.
- **Monitor runs** with `list_test_runs` using `include: ["events", "artifacts"]` to see step-by-step progress, failures, and screenshots.
- **Get single run** with `get_test_run` for status and result.
- **For environment changes** (base URL, credentials) that apply to many test cases, use `manage_project_configs` instead of updating each test case individually.

### 6. Stop Runs/Queues

- `stop_all_runs` — cancels QUEUED + PREPARING + RUNNING runs for a project
- `stop_all_queues` — cancels QUEUED runs only for a project
- Both require `projectId` and accept an optional `reason`

## Step Writing Rules

Steps default to `type: "ai-action"` — natural language executed by Midscene AI.

Use `type: "playwright-code"` when the step needs precise, deterministic interaction that AI might interpret ambiguously. Common cases:
- **Login flows** — when the test plan includes verified Playwright code (originally generated in `/skytest-1-explore`)
- **Navigation** — sidebar menus, hierarchical menu clicks, tab switching where labels may be ambiguous
- **Dropdown selection** — selecting specific options from `<select>` elements
- **Any step the user provides explicit Playwright code for**

### Login Step Handling

The login step is typically Step 1 in every test case. How it is created depends on what `/skytest-2-plan` provided:

**If the test plan includes a `playwright-code` login step** (selectors verified):
- Use it as a single step with `"type": "playwright-code"`
- The code uses `vars['VARIABLE_NAME']` for all credentials
- Include it verbatim — do not modify the selectors or assertions
- Reuse the identical step across all test cases that require login

**If the test plan includes `ai-action` login steps** (selectors not verified):
- Use them as `"type": "ai-action"` steps
- These use `{{VARIABLE_NAME}}` syntax for credentials
- This is the safe fallback — Midscene AI will locate elements at runtime

**Never generate Playwright code for login yourself.** Login code accuracy is established in `/skytest-1-explore` (selector capture and code generation). If the plan says ai-action, use ai-action. Do not attempt to upgrade it.

### ai-action Steps

- Use natural language describing visible UI elements by their labels
- Batch related sub-actions into single steps (fill multiple fields in one step)
- Prefix verification steps with Verify/Assert/Check/Confirm/Ensure/Validate
- Use `{{VARIABLE}}` for all configurable values
- Each step targets a specific browser/Android target ID

### playwright-code Steps

- Access project/test-case variables via `vars["VARIABLE_NAME"]`
- Use Playwright's recommended locators: `getByRole`, `getByText`, `getByLabel`, `locator('css-selector')`

### Anti-patterns — Never Do These

- **Vague assertions**: "Verify the page looks correct" — specify what should be visible
- **Assuming invisible state**: "Wait for the API to respond" — verify a visible UI change instead
- **Over-granular steps**: separate step for each form field — combine into one fill step
- **Hardcoded values**: `john@test.com` in step text — use `{{LOGIN_EMAIL}}`
- **Using `page.goto()` for in-app navigation** — always click through the UI instead
- **Combining verify + action + verify** in one ai-action step — split into atomic steps
- **Using playwright-code for scrolling** — use ai-action instead (e.g., "Scroll to the bottom of the page")

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

**Split verifications around scroll:** verify above-fold content, scroll down, verify below-fold content. Asserting below-fold elements before scrolling will fail.

### Navigation by Clicking

**Never use `page.goto()` for in-app navigation.** Click through the UI like a real user.

For hierarchical menus (sidebar with parent → child), click parent first, then child. Use playwright-code for navigation when labels are ambiguous.

```javascript
// Sidebar navigation pattern (playwright-code)
await page.getByText('Parent Menu', { exact: true }).click();
await page.getByRole('link', { name: 'Sub Page' }).click();
```

Establish navigation code once per menu path and reuse across all cases targeting the same page. If navigation fails, ask the user for correct code — don't guess selectors.

## Config Rules

- Names: `UPPER_SNAKE_CASE`
- `VARIABLE` type for credentials (`masked: true` for passwords)
- `URL` type for base URLs
- `RANDOM_STRING` for unique test data per run
- `APP_ID` type for Android app identifiers
- `FILE` type excluded — SkyTest does not support file attachments via MCP. Skip file-type configs entirely.
- Only include test-case-level variables for values NOT already in the project config

## Target Config Defaults

- **Browser**: `{ url: "...", width: 1920, height: 1080 }`
- **Android**: `{ type: "android", deviceSelector: {...}, appId: "...", clearAppState: true, allowAllPermissions: true }`
- Default to browser unless user specifies Android

### Android Device Resolution

Pass the device name the user provides in the `device` field (e.g., `"Pixel 8"`, `"Medium Phone"`). The server resolves it against the device inventory.

If the server response includes a warning that the device was not found in inventory, **stop and confirm with the user** before running the test.

When inventory is available, prefer explicit selectors from `list_runner_inventory`:
- Connected device: `{ mode: "connected-device", serial: "<serial>" }`
- Emulator profile: `{ mode: "emulator-profile", emulatorProfileName: "<profile>" }`

## Create Call Checklist

Before each `create_test_case` call, verify:
- [ ] Single `testCase` object (never batch)
- [ ] `name` follows `[Section] Short description` format
- [ ] `testCaseId` follows the user's established ID convention
- [ ] Target IDs used consistently in every step's `target` field
- [ ] Complete target definitions for all referenced targets
- [ ] All `{{VAR}}` references have matching variables (test-case-level or project-level)
- [ ] Step `type` set correctly (`ai-action` or `playwright-code`)
- [ ] No `FILE` variable in payload
- [ ] Only test-case-specific variables included (not duplicating project-level configs)

If the server skips a variable due to matching project config, inform the user which project variable is being reused.

## Example: Create Call with Playwright Login Step

When the test plan provides verified login Playwright code, the login becomes a single `playwright-code` step:

```json
{
  "projectId": "proj_123",
  "testCase": {
    "name": "[Settings] Update Display Name",
    "testCaseId": "SETNГ-001",
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
        "action": "await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();\nawait page.getByRole('textbox', { name: 'Email address' }).fill(vars['LOGIN_EMAIL']);\nawait page.getByRole('textbox', { name: 'Password' }).fill(vars['LOGIN_PASSWORD']);\nawait page.getByRole('button', { name: 'Sign In' }).click();\nawait expect(page.getByText('Welcome back')).toBeVisible();",
        "type": "playwright-code"
      },
      {
        "id": "step_2",
        "target": "browser_a",
        "action": "Click 'Settings' in the sidebar",
        "type": "ai-action"
      },
      {
        "id": "step_3",
        "target": "browser_a",
        "action": "Click the 'Edit Profile' button",
        "type": "ai-action"
      },
      {
        "id": "step_4",
        "target": "browser_a",
        "action": "Clear the 'Display Name' field and type '{{TEST_DISPLAY_NAME}}'",
        "type": "ai-action"
      },
      {
        "id": "step_5",
        "target": "browser_a",
        "action": "Click the 'Save Changes' button",
        "type": "ai-action"
      },
      {
        "id": "step_6",
        "target": "browser_a",
        "action": "Verify success toast 'Profile updated' appears and the 'Display Name' field shows '{{TEST_DISPLAY_NAME}}'",
        "type": "ai-action"
      }
    ],
    "variables": [
      { "name": "TEST_DISPLAY_NAME", "type": "RANDOM_STRING" }
    ]
  }
}
```

## Example: Create Call with ai-action Login Fallback

When login selectors were not verified, use ai-action steps:

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

After completing all operations, summarize:
- Created cases by priority (P0/P1/P2/P3)
- Reused project variables
- Updated cases and fields changed
- Skipped cases and reasons (including any flagged for manual testing)
- Stop/delete actions executed
- Coverage gaps and recommended next tests

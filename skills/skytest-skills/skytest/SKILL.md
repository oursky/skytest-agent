---
name: skytest
description: >
  Create, update, run, and manage SkyTest test cases via MCP — directly from the
  user's instructions, with no separate explore/plan phase. Accepts short prompts
  ("add a test that creates a product and verifies it in the list") or exact step
  lists; fills in element detail from existing test cases, screenshots, or a quick
  browser-tool pass. Writes playwright-code steps for deterministic interactions
  (clicks, fills, dropdowns, datepickers) and ai-action for visual verification.
  Also handles section coverage design, project configs, runner inventory, run
  monitoring, and stop operations. For diagnosing a failed run, use skytest-fix.
---

# SkyTest Skill

Turn user instructions into reliable SkyTest test cases and manage them via MCP. Work from whatever the user gives — a one-line request, exact steps, screenshots, or a section name. Fill gaps from project context first; ask the user only what you genuinely cannot infer.

## Non-Negotiable Rules

- **One test case per `create_test_case` / `update_test_case` call** — never batch.
- **Confirm before create, update, delete, or run.** Bulk confirmation is fine for creation ("create all", "create 1–8, skip 9"); confirm deletes individually.
- **Never hardcode credentials or URLs** — `vars['NAME']` in playwright-code, `{{NAME}}` in ai-action. Credentials live in project or test-case variables.
- **Users give display IDs** (e.g., `AUTH-01-001`); MCP tools need the internal `id` — resolve via `list_test_cases` first. After create, use the returned `id`.
- **`name` format:** `[Section] Short description`. **`testCaseId`:** follow the project's existing convention; default `XXXX-YY-ZZZ` (feature abbreviation + 2-digit section + 3-digit case, e.g., `AUTH-01-001`).
- **Browser target names must be descriptive** (e.g., "Admin Portal") — never "Primary Browser".
- **No `FILE` variables via MCP.** Never read, download, or process video files — ask for screenshots instead.
- **Don't queue runs unprompted** — the one exception: offer to validate the first case of a new batch with a run.
- `stop_all_runs` cancels QUEUED + PREPARING + RUNNING; `stop_all_queues` cancels QUEUED only.

## Step Typing: Playwright-First

Validated in practice: deterministic interactions run faster and far more reliably as `playwright-code` than as ai-action. Type steps by this policy:

**playwright-code — default for interactions:**
- Clicking buttons, links, sidebar/menu navigation, tabs
- Filling text inputs and textareas, clearing fields
- Selecting from dropdowns (`selectOption`), comboboxes, custom date/time pickers
- Checkboxes, radios, toggles
- Login flows (always, when selectors are known)
- Keyboard sequences (Tab, Enter, Escape)
- Exact element/text assertions when the locator is known: `await expect(...).toBeVisible()`

**ai-action — for what code can't express reliably:**
- Visual or fuzzy verification ("Verify the order summary shows the product name and a price")
- Scrolling ("Scroll to the bottom of the page")
- Steps on screens whose structure is unknown and can't be captured
- Highly dynamic or canvas-like widgets where selectors are unstable

### Selector Confidence Ladder

How sure you are about an element decides whether a step gets code:

1. **Verified** — you interacted with the element via a connected browser tool (Playwright MCP / Chrome DevTools MCP), or the user supplied the code, or an existing passing test case uses the same selector. Use playwright-code as-is.
2. **Exact label known** — visible label text from screenshots, an existing test case, or the user's description. For standard controls (buttons, labeled inputs, native selects), write playwright-code with role/label locators — `getByRole('button', { name: 'Save' })` — and validate with a first run.
3. **Unknown** — no label, no screenshot, no browser access. Use ai-action. **Never fabricate selectors.**

### playwright-code Sandbox Facts

- Globals: `page`, `expect` (timeout pre-configured), `vars` (resolved variables), `setTimeout`/`setInterval`. No imports, no Node APIs.
- Statements execute one at a time, each with its own timeout and trace line — a multi-statement step (e.g., a whole login or form fill) is fine and preferred over many one-line steps.
- Prefer `getByRole` / `getByLabel` / `getByText`; add `{ exact: true }` when a name could partially match.
- Insert `await expect(...).toBeVisible()` between page transitions — it doubles as a wait gate.
- Enter the app via the target's configured `url`; navigate inside the app by clicking, not `page.goto()`.

### Step Writing Rules (both types)

- **Atomic ai-action steps:** never verify + act + verify in one ai-action step — split it. (playwright-code steps may group a logical action sequence.)
- **Gate every transition:** after each navigation or mutation, assert a landmark (heading, toast, updated value) before the next interaction.
- **Scroll before below-fold interaction** (ai-action scroll step); verify above-fold, scroll, verify below-fold.
- **Assert consequences, not appearance:** after create → record visible in list; after delete → record gone; after login → user identity visible; after error → message shown and input preserved.
- **Dynamic values** (timestamps, counts) → assert presence/format, not exact value. Static labels → exact text.
- **Every `{{VAR}}` needs a matching variable** (test-case or project level). `{{TIMESTAMP}}` is NOT built-in — declare a `RANDOM_STRING` variable.

## MCP Operations

| Tool | Purpose |
|------|---------|
| `list_projects` / `get_project` | Projects and project-level configs |
| `get_project_test_summary` | Status breakdown across test cases |
| `list_test_cases` / `get_test_case` | Existing coverage; full case with steps, configs, last 5 runs |
| `create_test_case` / `update_test_case` / `delete_test_case` | One case per call |
| `run_test_case` | Queue one run; overrides: `url`, `prompt`, `steps`, `browserConfig`, `requestedDeviceId`, `requestedRunnerId` |
| `list_test_runs` / `get_test_run` | Monitor runs; `include: ["events", "artifacts"]` for step detail |
| `manage_project_configs` | Upsert/remove project-level configs in one call |
| `list_runner_inventory` | Runner/device inventory and Android selector options |
| `stop_all_runs` / `stop_all_queues` | Cancel runs (`projectId` required, optional `reason`) |

## Workflow

### 1. Read the Request, Pick a Mode

- **Exact-steps mode** — the user described the flow, even briefly. The most common case. Expand their description into typed steps; don't ask them to re-specify what they already said.
- **Coverage mode** — the user named a section without steps ("cover the Products section"). Apply the decomposition pattern below and present the case list for one confirmation.
- **Management mode** — update/run/delete/configs/stop on existing cases. Skip to step 6.

### 2. Inherit Project Conventions — Ask Only What You Can't Infer

1. `list_projects` → confirm the target project (skip if obvious from context).
2. `get_project` → project-level configs. Reuse `BASE_URL`, `LOGIN_EMAIL`, `LOGIN_PASSWORD`, etc. — never duplicate them as test-case variables. Tell the user what's being reused.
3. `list_test_cases` → existing coverage. If a similar case exists, propose updating it instead of duplicating.
4. **If the project already has test cases**, `get_test_case` on a representative one and inherit: browser target name, viewport, starting URL, the login step (copy verbatim — type and all), ID convention, variable naming. **Do not re-ask the user for things existing cases already establish.**
5. **Only for a project's first test cases**, confirm in ONE batched question: target name, viewport (suggest by app type: 1920×1080 desktop admin, 390×844 mobile), starting URL, credential variables, ID convention.
6. Android: `list_runner_inventory`; confirm `{ mode: "connected-device", serial }` or `{ mode: "emulator-profile", emulatorProfileName }`. If the server warns a device wasn't found, stop and confirm.

### 3. Fill In Element Detail — Only Where Needed

For steps at confidence level "unknown":

- **Browser tool connected** (Playwright MCP / Chrome DevTools MCP): walk only the screens the flow touches, capture exact roles/names from snapshots, and verify tricky interactions live before writing them into steps. Capture the login flow once and reuse it across every case.
- **No browser tool:** ask the user for screenshots of just the unclear screens, or fall back to ai-action for those steps.

Never explore the whole app — only the screens in the flow under test.

### 4. Check Automation Boundaries, Then Draft

SkyTest automates only what happens inside a clean browser session or installed Android APK. **Cannot be automated:** email/OTP/SMS, CAPTCHA, third-party auth or payment popups leaving the app domain, file uploads, download verification, multi-tab/new-window flows, push notifications, backend-only checks, external hardware. Split the flow around these or flag for manual testing — never create a case that fails by design. Iframes: proceed with caution and flag.

Present each draft compactly: name, ID, target, numbered steps with type per step, new variables, reused project variables. For batches, present all and take bulk confirmation.

### 5. Create and Validate

- `create_test_case`, one per call, only after confirmation.
- **Pre-flight per call:** single `testCase` object · name/ID formats · descriptive target name · consistent target IDs across steps · every `{{VAR}}` has a variable · every `RANDOM_STRING` has a `value` generation type · no hardcoded credentials · correct step `type` · no `FILE` variables · no duplication of project-level configs.
- After the first case of a new batch, offer one validation run — it catches systemic issues (login code, base URL, missing variables) before they're duplicated across the batch. Fix before creating the rest.

### 6. Manage

- **Update:** `update_test_case` (fields: `name`, `url`, `prompt`, `steps`, `browserConfig`, `configs`/`variables`, `removeConfigNames`/`removeVariableNames`). If active runs exist, include `activeRunResolution`: `cancel_and_save` or `do_not_save`.
- **Environment-wide changes** (base URL, credentials): `manage_project_configs`, not per-case edits.
- **Delete:** irreversible — removes the case plus all runs, files, configs. Confirm individually.
- **MCP errors:** report the full message; don't auto-retry. Common: project not found, duplicate display ID, active runs blocking update, invalid payload.

## Coverage Mode: Section Decomposition

For CRUD admin / CMS sections (list view + detail + create/edit/delete), decompose **one concern per test case**:

| # | Case | Focus |
|---|------|-------|
| 1 | Navigation smoke (one per app) | Visit every main page via nav; assert heading + landmarks |
| 2 | List & detail | Assert list layout, search a fixture record, open detail, assert fields |
| 3 | Pagination | Page 2 shows different records; back to page 1 restores (skip if none) |
| 4 | Columns & sorting | Headers present; sort toggles order (skip if not sortable) |
| 5 | Create | Fill form with variables, submit, assert record in list; delete to clean up |
| 6 | Create → Edit | Create as setup, edit fields, assert updated values; clean up |
| 7 | Create → Delete | Create as setup, delete with confirm dialog, assert gone from list |

**Principles:** mutation tests focus on exactly one operation — creation inside edit/delete tests is setup, not subject. Variable-first: every dynamic value is a `{{VARIABLE}}`; unique fields use `RANDOM_STRING` with `TIMESTAMP_DATETIME`. Read tests (2–4) assert structure against fixture data; mutation tests (5–7) assert the entered variable values persisted. Self-cleanup when the UI allows deletion. Read-only sections: cases 1–4 only. Adapt for filters, bulk actions, wizards — same principles, one concern per case.

Other section shapes (storefront, wizard/onboarding, dashboard, settings) follow the same principles without a fixed template.

## Config Rules

- Names `UPPER_SNAKE_CASE`. `VARIABLE` for credentials (`masked: true` for passwords), `URL` for base URLs, `APP_ID` for Android app IDs.
- `RANDOM_STRING` **must include a `value`** generation type: `TIMESTAMP_DATETIME` (YYYYMMDDHHmmssSSS), `TIMESTAMP_UNIX`, or `UUID`.
- `group` field: include when the project uses team-scoped config groups.
- Test-case variables only for values not already in project config.

## Target Defaults

- **Browser:** `{ url: "...", width: 1920, height: 1080 }`
- **Android:** `{ type: "android", deviceSelector: {...}, appId: "...", clearAppState: true, allowAllPermissions: true }`

## Payload Example (playwright-first)

```json
{
  "projectId": "proj_123",
  "testCase": {
    "name": "[Products] Create Product",
    "testCaseId": "PROD-01-001",
    "browserTargets": [
      { "id": "browser_a", "name": "Admin Portal", "url": "https://admin.myapp.com/login", "width": 1920, "height": 1080 }
    ],
    "steps": [
      {
        "id": "step_1",
        "target": "browser_a",
        "action": "await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();\nawait page.getByRole('textbox', { name: 'Email address' }).fill(vars['LOGIN_EMAIL']);\nawait page.getByRole('textbox', { name: 'Password' }).fill(vars['LOGIN_PASSWORD']);\nawait page.getByRole('button', { name: 'Sign In' }).click();\nawait expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();",
        "type": "playwright-code"
      },
      {
        "id": "step_2",
        "target": "browser_a",
        "action": "await page.getByRole('link', { name: 'Products' }).click();\nawait expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();\nawait page.getByRole('button', { name: 'New Product' }).click();",
        "type": "playwright-code"
      },
      {
        "id": "step_3",
        "target": "browser_a",
        "action": "await page.getByRole('textbox', { name: 'Product name' }).fill(vars['PRODUCT_NAME']);\nawait page.getByRole('combobox', { name: 'Category' }).selectOption('Accessories');\nawait page.getByRole('button', { name: 'Save' }).click();",
        "type": "playwright-code"
      },
      {
        "id": "step_4",
        "target": "browser_a",
        "action": "Verify a success message appears and the product '{{PRODUCT_NAME}}' is visible in the products list",
        "type": "ai-action"
      }
    ],
    "variables": [
      { "name": "PRODUCT_NAME", "type": "RANDOM_STRING", "value": "TIMESTAMP_DATETIME" }
    ]
  }
}
```

`LOGIN_EMAIL` / `LOGIN_PASSWORD` are project-level configs — not duplicated in `variables`.

## Final Report

After completing operations, summarize: created cases (with IDs), reused project variables, updated cases and fields changed, skipped cases and reasons (including manual-testing flags), stop/delete actions, and recommended next coverage.

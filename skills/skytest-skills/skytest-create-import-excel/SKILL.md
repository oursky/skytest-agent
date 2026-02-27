---
name: skytest-create-import-excel
description: |
  Generate test cases from feature descriptions, screenshots, or user flow documentation
  and export them as Excel workbooks ready to import into SkyTest. Does not require MCP
  or a connected SkyTest instance. Studies user flows as a professional QA engineer,
  designs test cases one at a time with user confirmation, then generates one Excel
  workbook per confirmed test case using the SkyTest import format. Use when the user
  asks to generate tests or create test cases as Excel files, or when MCP is unavailable.
allowed-tools:
  - AskUserQuestion
  - Read
  - WebFetch
  - Bash
  - Write
---

# SkyTest Test Case Excel Generator

Generate comprehensive test cases from feature descriptions, screenshots, or user flow
documentation. Outputs one Excel workbook per confirmed test case, ready to import into
SkyTest via the run page or project import UI. No MCP connection required.

## When to Apply

- User asks to "generate tests as Excel", "import tests", "export test cases", or "create importable tests"
- User wants to generate test cases but does not have MCP / SkyTest connected
- User provides a feature description, screenshots, or URL to analyze

## Workflow

### 1. Gather Context

Ask the user for:
- **Feature description**: What does the feature do? What are the key user flows?
- **Platform**: Browser, Android, or both?
- **Output directory**: Where to save the generated Excel files (default: current directory)
- **Screenshots or documentation** (optional): Any visual context

**Required identifiers — do not proceed without these:**
- Any flow on a **web browser** requires the **base URL** (e.g., `https://myapp.com`)
- Any flow on a **mobile/Android app** requires the **Android app ID** (e.g., `com.example.app`)

If the platform is known but the required identifier is missing, ask for it before moving
to Step 2.

### 2. Understand the Product & User Flows

This is the CRITICAL step before generating any test cases. The goal is to produce a
complete, step-by-step walkthrough of every flow — with zero gaps or assumptions.

#### 2a. Understand the Business Context

Before exploring any feature, establish:
- What industry/domain is this product in? (e-commerce, healthcare, fintech, SaaS, etc.)
- Who are the target users?
- What are the core business workflows?
- Which flows directly affect revenue, security, or compliance?

If not obvious from the context provided, ask the user. You will use this understanding
to prioritize test cases by business risk in Step 3.

#### 2b. Understand Authentication First

Before studying any feature flow, **always** understand how the system is authenticated:
- How does a user log in? (username/password form, SSO, API key, magic link, etc.)
- What is the login URL or entry point?
- Are there multiple user roles with different access? Which role is needed for this feature?
- What credentials will be used for testing?

Ask the user to provide test credentials (username/password or equivalent). These will
become `Variable` configs (with `Masked: Y` for passwords) shared across all test cases.

Do NOT assume login works a certain way. If you cannot see the full login flow from the
context provided, ask the user to walk you through it.

#### 2c. Explore the App If Needed

Attempt to derive every step of every flow from the context the user has provided
(screenshots, description, URL, docs). For each step, ask yourself:
**"Do I know exactly what the user sees and does here?"**

If the answer is NO for ANY step — the UI is not shown, the outcome is unknown, a dialog
or redirect behavior is unclear — do NOT guess. Ask the user targeted questions to fill
the gap before proceeding.

Every flow must be derivable end-to-end with full confidence before you present it.
**A flow with any unclear step is not ready to present.**

#### 2d. Document and Present the Flows

Once you have enough information to describe every flow completely, present them as a
structured step-by-step list. Each step must describe exactly what the user does and
what they see — specific button labels, field names, dialog titles, page transitions.

Example output:
```
I've identified these key user flows for the Login feature:

**Flow 1: Email/Password Login**
1. Navigate to /login — page shows email and password fields and a "Sign In" button
2. Enter email in the "Email address" field
3. Enter password in the "Password" field
4. Click the "Sign In" button
5. Redirected to /dashboard — page shows the "Welcome back" heading

**Flow 2: Forgot Password**
1. Navigate to /login
2. Click "Forgot your password?" link below the Sign In button
3. Redirected to /forgot-password — page shows a single email input field
4. Enter email and click "Send reset link"
5. Page shows confirmation: "Check your inbox for a reset link"
```

Present these flows to the user and ask for confirmation:
- Are these flows correct?
- Any missing flows?
- Any flows to skip?
- Any specific edge cases to cover?

**Do NOT proceed to test case planning until the user explicitly confirms the flows**
(e.g., "ok", "confirm", "yes"). If the user provides corrections, revise and re-present.
Never auto-proceed — always wait for explicit confirmation at EVERY checkpoint.

### 3. Design Test Cases with Risk-Based Prioritization

Design test cases like a QA engineer who understands business impact. Not all bugs are
equal — a payment processing failure costs the company revenue; a misaligned icon does not.

#### 3a. Classify Flows by Business Risk

Before designing individual test cases, classify each confirmed flow:

- **P0 — Revenue / Security / Compliance**: Payments, authentication, authorization,
  personal data handling, regulatory flows. Failure = direct business loss, security
  breach, or legal exposure.
- **P1 — Core User Journeys**: Primary workflows users rely on daily. Failure = users
  cannot accomplish their goal, likely to churn or escalate to support.
- **P2 — Error Handling & Edge Cases**: Input validation, error recovery, boundary
  conditions, secondary features. Failure = degraded experience but workarounds exist.
- **P3 — Polish & Rare Scenarios**: Unusual input combinations, cosmetic consistency,
  rare device/browser configurations.

Present the prioritized classification to the user. Design and create test cases
starting from P0 downward.

#### 3b. Apply Structured Test Design

For each flow, design cases using these techniques — not just "happy path + negative":

- **Happy path**: The standard successful flow as confirmed in Step 2.
- **Input validation**: For each user-facing field, test invalid input (wrong format),
  empty input, boundary-length input, and special characters. Group related fields into
  one case where they share validation behavior.
- **Business rule enforcement**: Test constraints the system must enforce. Examples:
  cannot checkout with empty cart, cannot transfer more than account balance, required
  fields block submission, duplicate entries are rejected.
- **State transitions**: Back button mid-flow, page refresh, double-click submit,
  navigating away then returning, session expiry during a multi-step flow.
- **Error recovery**: After triggering an error, the user corrects their input and
  completes the flow successfully — without restarting.
- **Authorization boundaries**: If multiple roles exist, verify users cannot access or
  modify resources beyond their role. (Only if roles were identified in Step 2b.)

Do NOT present all cases as one big batch for approval.

#### 3c. Ensure Test Independence

Every test case must be fully self-contained:
- Starts from the entry point (URL or app launch)
- Includes its own authentication steps if login is required
- Does not depend on another test case having run first
- Clearly notes any preconditions that require manual data setup (e.g., "an existing
  order must be present to test cancellation")

If setup steps are needed (e.g., creating test data), include them as initial steps
within the test case, or document the prerequisite for the user to prepare beforehand.

### 4. Review One Test Case at a Time

For each candidate test case, follow this loop:

1. Draft exactly ONE test case (title, priority, steps, assertions, configs, targets).
2. Present only that one test case to the user for review.
3. Ask for explicit decision: confirm, modify, or skip.
4. If user confirms, add it to the confirmed list.
5. If user asks to modify, revise and re-present the same case.
6. If user skips, do not add it; move to the next case.

**Never present all test cases as a full approval batch.**

Keep a running list of confirmed test cases in memory as you iterate through them.

### 5. Case Writing Standards

#### Step Writing Rules (Midscene best practices)

- Use natural language describing visible UI elements by their labels
- Batch related sub-actions into single steps (fill multiple form fields in one step)
- Prefix verification steps with Verify/Assert/Check/Confirm/Ensure/Validate
- Use `{{VARIABLE}}` for all configurable values (credentials, URLs, varying test data)
- Each step targets a specific browser/Android target ID

**Anti-patterns — never do these:**
- Vague assertions: "Verify the page looks correct" → specify what should be visible
- Assuming invisible state: "Wait for the API to respond" → instead: "Verify the loading
  indicator disappears and the results table is displayed"
- Over-granular steps: separate steps for each form field → combine into one fill step
- Hardcoded values that should be variables: writing `john@test.com` directly in step
  text → use `{{LOGIN_EMAIL}}`

#### Assertion Depth

Go beyond surface-level checks. A senior QA verifies *consequences*, not just appearance:

- **After a create action**: Verify the new item appears in the relevant list or table,
  not just that a success toast appeared
- **After a delete action**: Verify the item is gone from the list, not just that a
  confirmation dialog was dismissed
- **After a form submit**: Verify the submitted data is reflected on the detail/view page,
  not just that the form closed
- **After login**: Verify user identity is displayed (name or email in the header),
  not just that the URL changed
- **After an error**: Verify the specific error message text and that the user's
  previously entered data is preserved (not cleared)

**Static vs Dynamic Assertions:**
- **Static UI** (menu names, page titles, column headers, form labels, button text) →
  assert exact text:
  `Verify the page title is 'Account Settings'`
  `Verify the table has columns 'Name', 'Email', 'Status', 'Actions'`
- **Dynamic content** (user-generated data, timestamps, counts, notifications with
  variable values) → assert presence or pattern:
  `Verify a success notification is displayed`
  `Verify the order list shows at least one order`
- When unsure if content is static or dynamic, prefer generic description

#### Realistic Test Data

Choose test data appropriate to the product's business domain:
- **E-commerce**: realistic product names, prices, shipping addresses, card formats
- **Healthcare**: appropriate patient IDs, appointment types, medical terminology
- **Fintech**: realistic account numbers, transaction amounts, currency formats
- **SaaS/B2B**: realistic workspace names, team member roles, organization structures

Never use "test123", "foo@bar.com", "Lorem ipsum", or obvious placeholders.
The goal is to trigger bugs that occur under real production usage patterns.

For error-path testing, use *realistic* invalid inputs — the kind real users actually
type (typos in emails, too-short passwords, pasting text into number fields).

#### Config Rules

- Names: `UPPER_SNAKE_CASE` only
- Use `Variable` type for credentials (with `Masked: Y` for passwords)
- Use `URL` type for base URLs
- Use `Random String` for unique test data (e.g., unique usernames per run)
- Do NOT include `File` variables (import cannot upload file content)

#### Target Config

- Browser: Target label `Browser A`, URL, Width: 1920, Height: 1080
- Android: Target label `Android A`, Device (emulator profile name or `serial:<adb>`),
  APP ID, Clear App Data: Yes, Allow Permissions: Yes

### 6. Generate Excel Workbooks

After all test cases have been reviewed, generate one Excel workbook per confirmed case.

**Before generating**, verify each case has:
- A name and a displayId (e.g., `LOGIN-001`)
- At least one target (browser or Android)
- All steps with target references that match defined targets
- All `{{VAR_NAME}}` placeholders backed by a variable row
- No FILE variables in the payload

**Excel format — one workbook per test case with four sheets:**

#### Sheet 1: `Configurations`

| Section | Type | Name | Value | Group | Masked |
|---------|------|------|-------|-------|--------|
| Basic Info | Test Case Name | [test case name] | | | |
| Basic Info | Test Case ID | [displayId] | | | |
| Test Case Variable | URL | BASE_URL | https://... | | |
| Test Case Variable | Variable | LOGIN_EMAIL | john@example.com | | |
| Test Case Variable | Variable | LOGIN_PASSWORD | | | Y |
| Test Case Variable | Random String | UNIQUE_USERNAME | UUID | | |

Variable `Type` values accepted by import:
- `URL` — for URL variables
- `Variable` — for plain string/credential variables (use `Masked: Y` for secrets)
- `Random String` — for generated values; `Value` must be one of:
  `UUID`, `Timestamp (Unix)`, `Timestamp (Datetime)`
- Do NOT include `File` rows

#### Sheet 2: `Browsers`

| Target | Name | URL | Width | Height |
|--------|------|-----|-------|--------|
| Browser A | Primary Browser | https://myapp.com/login | 1920 | 1080 |

Only include rows for browser targets used in this test case.
Omit rows (keep header only) if no browser targets.

#### Sheet 3: `Android`

| Target | Name | Device | APP ID | Clear App Data | Allow Permissions |
|--------|------|--------|--------|----------------|-------------------|
| Android A | Main Device | Pixel_7_API_34 | com.example.app | Yes | Yes |

Use `serial:<adb-serial>` in Device column for physical connected devices.
Omit rows (keep header only) if no Android targets.

#### Sheet 4: `Test Steps`

| Step No | Browser | Type | Action |
|---------|---------|------|--------|
| 1 | Browser A | AI | Navigate to the login page at {{BASE_URL}}/login |
| 2 | Browser A | AI | Fill in the 'Email address' field with '{{LOGIN_EMAIL}}' and the 'Password' field with '{{LOGIN_PASSWORD}}' |
| 3 | Browser A | AI | Click the 'Sign In' button |
| 4 | Browser A | AI | Verify the page displays the 'Dashboard' heading and the user's email '{{LOGIN_EMAIL}}' appears in the top navigation bar |

Notes:
- `Browser` column is used for ALL target types (both browser and Android) — this is
  the required column name regardless of platform
- `Type` must be `AI` for ai-action steps or `Code` for playwright-code steps
- `Step No` is a sequential integer starting from 1

**Generation method:**

Use Python with `openpyxl` to generate the Excel file. First check if openpyxl is
available; if not, install it:

```bash
python3 -c "import openpyxl" 2>/dev/null || pip3 install openpyxl
```

Write a Python script to `_skytest_excel_gen.py` in the output directory, run it, then
delete it. Name each output file as `[displayId]-[safe-name].xlsx`, for example
`LOGIN-001-login-happy-path.xlsx`.

**Python generation script template:**

```python
import openpyxl
from openpyxl.styles import Font
from openpyxl import Workbook

def add_header_row(ws, headers):
    ws.append(headers)
    for cell in ws[ws.max_row]:
        cell.font = Font(bold=True)

def generate_test_case(output_path, tc):
    wb = Workbook()

    # Configurations
    ws = wb.active
    ws.title = "Configurations"
    add_header_row(ws, ["Section", "Type", "Name", "Value", "Group", "Masked"])
    ws.append(["Basic Info", "Test Case Name", tc["name"], "", "", ""])
    ws.append(["Basic Info", "Test Case ID", tc["displayId"], "", "", ""])
    for v in tc.get("variables", []):
        ws.append(["Test Case Variable", v["type"], v["name"],
                    v.get("value", ""), v.get("group", ""),
                    "Y" if v.get("masked") else ""])

    # Browsers
    ws_b = wb.create_sheet("Browsers")
    add_header_row(ws_b, ["Target", "Name", "URL", "Width", "Height"])
    for t in tc.get("browserTargets", []):
        ws_b.append([t["target"], t.get("name", ""), t["url"],
                      t.get("width", 1920), t.get("height", 1080)])

    # Android
    ws_a = wb.create_sheet("Android")
    add_header_row(ws_a, ["Target", "Name", "Device", "APP ID",
                           "Clear App Data", "Allow Permissions"])
    for t in tc.get("androidTargets", []):
        ws_a.append([t["target"], t.get("name", ""), t["device"], t["appId"],
                      "Yes" if t.get("clearAppData", True) else "No",
                      "Yes" if t.get("allowPermissions", True) else "No"])

    # Test Steps
    ws_s = wb.create_sheet("Test Steps")
    add_header_row(ws_s, ["Step No", "Browser", "Type", "Action"])
    for i, s in enumerate(tc.get("steps", []), start=1):
        ws_s.append([i, s["target"], s.get("stepType", "AI"), s["action"]])

    wb.save(output_path)
    print(f"Generated: {output_path}")

# --- Populate from confirmed test cases ---
TEST_CASES = []

for tc in TEST_CASES:
    safe = tc["name"].lower().replace(" ", "-").replace("/", "-")
    generate_test_case(f"{tc['displayId']}-{safe}.xlsx", tc)
```

Populate `TEST_CASES` with all confirmed test cases, write the script, run it, then
remove the script. Report each generated filename to the user.

### 7. Final Report

After generating all workbooks, summarize:
- Generated files and their paths, grouped by priority (P0/P1/P2/P3)
- Skipped cases and reasons
- Variables that need values filled in post-import (masked passwords, etc.)
- Gaps in coverage — flows or risk areas not yet covered
- Instructions for importing into SkyTest:
  > Open SkyTest → your project → Import (or the run page) → upload each `.xlsx` file

## Guidelines

- Always understand flows FIRST, then design and create test cases.
- **ALWAYS wait for explicit user confirmation** before proceeding. Mandatory checkpoints:
  1. After presenting identified end-to-end user flows
  2. Before adding each individual test case to the confirmed list
- **Design P0 cases first** — always start with the highest business-risk flows
- **Every test case must be independent** — runnable in isolation, no implicit state
  dependencies on other cases
- Never present all test cases as a full approval batch.
- **Understand authentication before anything else** — know the login mechanism, entry
  point, roles, and test credentials before studying any feature flow.
- **Never guess a step** — if any step in a flow is unclear, ask the user.
- **Verify consequences, not just appearance** — assert that actions had their intended
  effect (item appears in list, data saved correctly), not just that a toast or animation
  played.
- Prefer fewer, well-structured steps over many granular steps.
- Set `Masked: Y` for any sensitive values (passwords, tokens, API keys).
- Use descriptive `displayId` values (e.g., "LOGIN-001", "CHECKOUT-003").
- Default to browser targets unless user specifies Android.
- Default viewport: 1920×1080 for browser targets.
- Do NOT include FILE variables — inform the user to upload files via SkyTest UI after import.

## Example: Complete Test Case Data Structure (for generation script)

```python
{
    "name": "Login - Happy Path",
    "displayId": "LOGIN-001",
    "browserTargets": [
        {
            "target": "Browser A",
            "name": "Primary Browser",
            "url": "https://myapp.com/login",
            "width": 1920,
            "height": 1080
        }
    ],
    "androidTargets": [],
    "variables": [
        { "type": "Variable", "name": "LOGIN_EMAIL", "value": "john.smith@company.com" },
        { "type": "Variable", "name": "LOGIN_PASSWORD", "value": "", "masked": True }
    ],
    "steps": [
        {
            "target": "Browser A",
            "stepType": "AI",
            "action": "Fill in the 'Email address' field with '{{LOGIN_EMAIL}}' and the 'Password' field with '{{LOGIN_PASSWORD}}'"
        },
        {
            "target": "Browser A",
            "stepType": "AI",
            "action": "Click the 'Sign In' button"
        },
        {
            "target": "Browser A",
            "stepType": "AI",
            "action": "Verify the page displays the 'Dashboard' heading and the user's email '{{LOGIN_EMAIL}}' appears in the top navigation bar"
        }
    ]
}
```

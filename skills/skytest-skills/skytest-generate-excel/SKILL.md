---
name: skytest-generate-excel
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

If not obvious from the context provided, ask the user.

#### 2b. Understand Authentication First

Before studying any feature flow, **always** understand how the system is authenticated:
- How does a user log in? (username/password form, SSO, API key, magic link, etc.)
- What is the login URL or entry point?
- Are there multiple user roles with different access? Which role is needed for this feature?
- What credentials will be used for testing?

Ask the user to provide test credentials (username/password or equivalent). These will
become `VARIABLE` configs (with `masked: true` for passwords) shared across all test cases.

Do NOT assume login works a certain way. If you cannot see the full login flow from the
context provided, ask the user to walk you through it.

#### 2c. Explore the App Live If Needed

Attempt to derive every step of every flow from the context the user has provided
(screenshots, description, URL, docs). For each step, ask yourself:
**"Do I know exactly what the user sees and does here?"**

If the answer is NO for ANY step — the UI is not shown, the outcome is unknown, a dialog
or redirect behavior is unclear — do NOT guess. Instead ask the user targeted questions
to fill the gap before proceeding.

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

### 3. Design Test Cases as Professional QA

Design functional test cases from the confirmed end-to-end flows:
- Happy path coverage
- High-risk negative paths
- Input validation and boundary cases
- State transition checks
- Business-critical guardrails

Before writing each case, map it to a specific confirmed flow step sequence (starting
from entry URL or Android app ID, then login, then feature flow). Do not design cases
based on assumptions outside the confirmed flow.

Do NOT present all cases as one big batch for approval.

### 4. Review One Test Case at a Time

For each candidate test case, follow this loop:

1. Draft exactly ONE test case (title, scope, steps, assertions, configs, targets).
2. Present only that one test case to the user for review.
3. Ask for explicit decision: confirm/create, clarify/modify, or skip.
4. If user confirms, add it to the confirmed list.
5. If user asks to modify, revise and re-present the same case.
6. If user skips, do not add it; move to the next case.

**Never present all test cases as a full approval batch.**

Keep a running list of confirmed test cases in memory as you iterate through them.

### 5. Case Writing Standards

**Step Writing Rules** (Midscene best practices):
- Use natural language, describe visible UI elements
- Prefix verification steps with Verify/Assert/Check/Confirm/Ensure/Validate
- Batch related sub-actions into single steps
- Use `{{VARIABLE}}` for config references
- Each step targets a specific browser/Android target ID

**Realistic Test Data:**
- Always use realistic, domain-appropriate test data — not "test123" or "lorem ipsum"
- For email fields: use realistic emails like `john.smith@company.com`
- For names: use common real names appropriate to the product's locale
- For error testing: use realistic invalid inputs that real users might enter

**Static vs Dynamic Assertions:**
- **Static UI elements** (menu tab names, page titles, column headers, button text) →
  assert exact text: `Verify the page title is 'Account Settings'`
- **Dynamic/temporary data** (user-generated content, timestamps, counts, notifications
  with variable values) → use generic descriptions:
  `Verify a success notification is displayed`

**Config Rules:**
- Names: `UPPER_SNAKE_CASE` only
- Use `Variable` type for credentials (with `Masked: Y` for passwords)
- Use `URL` type for base URLs
- Use `Random String` for unique test data (e.g., unique usernames per run)
- Do NOT include `File` variables (import cannot upload file content)

**Target Config:**
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
| Browser B | Secondary Browser | https://myapp.com | 1920 | 1080 |

Only include rows for browser targets used in this test case.
Omit sheet entirely (or leave empty after header) if no browser targets.

#### Sheet 3: `Android`

| Target | Name | Device | APP ID | Clear App Data | Allow Permissions | Device Details (separate by /) |
|--------|------|--------|--------|----------------|-------------------|-------------------------------|
| Android A | Main Device | Pixel_7_API_34 | com.example.app | Yes | Yes | Pixel_7_API_34 / Emulator profile |

Use `serial:<adb-serial>` in Device column for physical connected devices.
Omit sheet entirely (or leave empty after header) if no Android targets.

#### Sheet 4: `Test Steps`

| Step No | Browser | Type | Action |
|---------|---------|------|--------|
| 1 | Browser A | AI | Navigate to the login page at {{BASE_URL}}/login |
| 2 | Browser A | AI | Fill in the email field with '{{LOGIN_EMAIL}}' and the password field with '{{LOGIN_PASSWORD}}' |
| 3 | Browser A | AI | Click the 'Sign In' button |
| 4 | Browser A | AI | Verify the page displays the Dashboard heading |

Notes:
- `Browser` column is used for ALL target types (both browser and Android) — this is the
  required column name regardless of platform
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
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl import Workbook

def add_header_row(ws, headers):
    row = [headers]
    ws.append(headers)
    # Bold the header row
    for cell in ws[ws.max_row]:
        cell.font = Font(bold=True)

def generate_test_case(output_path, test_case):
    wb = Workbook()

    # --- Configurations sheet ---
    ws_config = wb.active
    ws_config.title = "Configurations"
    add_header_row(ws_config, ["Section", "Type", "Name", "Value", "Group", "Masked"])
    ws_config.append(["Basic Info", "Test Case Name", test_case["name"], "", "", ""])
    ws_config.append(["Basic Info", "Test Case ID", test_case["displayId"], "", "", ""])
    for var in test_case.get("variables", []):
        ws_config.append([
            "Test Case Variable",
            var["type"],       # URL | Variable | Random String
            var["name"],
            var.get("value", ""),
            var.get("group", ""),
            "Y" if var.get("masked") else ""
        ])

    # --- Browsers sheet ---
    ws_browsers = wb.create_sheet("Browsers")
    add_header_row(ws_browsers, ["Target", "Name", "URL", "Width", "Height"])
    for t in test_case.get("browserTargets", []):
        ws_browsers.append([
            t["target"],
            t.get("name", ""),
            t["url"],
            t.get("width", 1920),
            t.get("height", 1080)
        ])

    # --- Android sheet ---
    ws_android = wb.create_sheet("Android")
    add_header_row(ws_android, [
        "Target", "Name", "Device", "APP ID",
        "Clear App Data", "Allow Permissions",
        "Device Details (separate by /)"
    ])
    for t in test_case.get("androidTargets", []):
        ws_android.append([
            t["target"],
            t.get("name", ""),
            t["device"],
            t["appId"],
            "Yes" if t.get("clearAppData", True) else "No",
            "Yes" if t.get("allowPermissions", True) else "No",
            t.get("deviceDetails", "")
        ])

    # --- Test Steps sheet ---
    ws_steps = wb.create_sheet("Test Steps")
    add_header_row(ws_steps, ["Step No", "Browser", "Type", "Action"])
    for i, step in enumerate(test_case.get("steps", []), start=1):
        ws_steps.append([
            i,
            step["target"],        # target label e.g. "Browser A"
            step.get("stepType", "AI"),  # AI or Code
            step["action"]
        ])

    wb.save(output_path)
    print(f"Generated: {output_path}")

# --- TEST CASES ---
# (AI: populate this list from confirmed test cases)
TEST_CASES = []  # filled in by AI per confirmed cases

for tc in TEST_CASES:
    safe_name = tc["name"].lower().replace(" ", "-").replace("/", "-")
    filename = f"{tc['displayId']}-{safe_name}.xlsx"
    generate_test_case(filename, tc)
```

Populate `TEST_CASES` with all confirmed test cases, write the script, run it, then
remove the script. Report each generated filename to the user.

### 7. Final Report

After generating all workbooks, summarize:
- Generated files and their paths
- Test cases created vs skipped
- Any variables that need values filled in (masked passwords, etc.)
- Instructions for importing into SkyTest:
  > Open SkyTest → your project → Import (or the run page) → upload each `.xlsx` file

## Guidelines

- Always understand flows FIRST, then design and create test cases.
- **ALWAYS wait for explicit user confirmation** before proceeding. Mandatory checkpoints:
  1. After presenting identified end-to-end user flows
  2. Before adding each individual test case to the confirmed list
- Never present all test cases as a full approval batch.
- **Understand authentication before anything else** — know the login mechanism, entry
  point, roles, and test credentials before studying any feature flow.
- **Never guess a step** — if any step in a flow is unclear, ask the user.
- **Understand the product's business context** — use domain-appropriate terminology
  and realistic data in all test cases.
- **Realistic test data**: Use real-world-like values. Never use "test123" or placeholders.
- **Static vs dynamic assertions**: Assert exact text for static UI; use generic
  descriptions for dynamic content.
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
            "action": "Fill in the email field with '{{LOGIN_EMAIL}}' and the password field with '{{LOGIN_PASSWORD}}'"
        },
        {
            "target": "Browser A",
            "stepType": "AI",
            "action": "Click the 'Sign In' button"
        },
        {
            "target": "Browser A",
            "stepType": "AI",
            "action": "Verify the page displays the Dashboard heading"
        }
    ]
}
```

---
name: skytest-generate
description: |
  Generate test cases from feature descriptions, screenshots, or user flow documentation.
  Creates draft test cases in a SkyTest project with complete steps, configs, and target
  setup. Uses MCP create_test_cases single-create mode with import-equivalent fields
  (test case ID, targets, variables, AI/code steps). File upload is excluded. Use when
  the user asks to generate tests, create test cases, or automate test creation for a
  feature or user flow.
allowed-tools:
  - mcp__skytest_*
  - AskUserQuestion
  - Read
  - WebFetch
---

# SkyTest Test Case Generator

Generate comprehensive test cases from feature descriptions, screenshots, or user flow
documentation. Creates DRAFT test cases in a SkyTest project with complete steps, configs,
and browser/Android target setup.

## When to Apply

- User asks to "generate tests", "create test cases", or "write tests" for a feature
- User provides a feature description, screenshots, or URL to analyze
- User wants to automate test case creation for their web or Android application

## Workflow

### 1. Gather Context

Ask the user for:
- **Feature description**: What does the feature do? What are the key user flows?
- **Target project**: Which SkyTest project to add test cases to?
- **Platform**: Browser, Android, or both?
- **Screenshots or documentation** (optional): Any visual context

Use `list_projects` MCP tool to show available projects. If no project exists, ask if
you should create one.

**Required identifiers — do not proceed without these:**
- Any flow on a **web browser** requires the **base URL** (e.g., `https://myapp.com`)
- Any flow on a **mobile/Android app** requires the **Android app ID** (e.g., `com.example.app`)

If the platform is known but the required identifier is missing, ask for it before
moving to Step 2. These values are mandatory inputs for target configuration.

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
context provided, ask the user to walk you through it or connect a browser agent (see 2c).

#### 2c. Explore the App Live If Needed

Attempt to derive every step of every flow from the context the user has provided
(screenshots, description, URL, docs). For each step, ask yourself:
**"Do I know exactly what the user sees and does here?"**

If the answer is NO for ANY step — the UI is not shown, the outcome is unknown, a dialog
or redirect behavior is unclear — do NOT guess. Instead:

1. Ask the user to connect a browser agent to the running app so you can explore it live,
   navigating through the actual UI to observe each step firsthand.
2. If a browser agent is not available, ask the user targeted questions to fill the gap
   before proceeding.

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

This is still the second major phase after flow study confirmation.

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

### 4. Review and Create One Test Case at a Time

For each candidate test case, follow this loop:

1. Draft exactly ONE test case (title, scope, steps, assertions, configs, targets).
2. Present only that one test case to the user for review.
3. Ask for explicit decision: confirm/create, clarify/modify, or skip.
4. If user confirms, create only that single case via MCP.
5. If user asks to modify, revise and re-present the same case.
6. If user skips, do not create it; move to the next case.

**Creation rule:** never create in batch when running this skill.  
Call `create_test_cases` with a single `testCase` object each time:
`{ projectId, testCase: { ...all case details... } }`.

**All-details creation rule:** each confirmed case must include all creatable import details:
- `name`
- `displayId` or `testCaseId`
- targets (`browserConfig` map and/or `browserTargets` / `androidTargets`)
- `steps` with explicit `type` (`ai-action` or `playwright-code`)
- test-case variables via `configs` or `variables`

**File constraint:** do not send `FILE` variables through MCP create. MCP cannot upload file
content for users. If file variables are required, create the case first, then tell the user
to upload files in SkyTest UI/API and bind them afterward.

Use `get_project` before creation to reuse existing project-level configs and avoid
duplicates.

**Project variable reuse (server-enforced):** when you submit a test-case variable whose
`type` and `value` exactly match an existing project-level config, the server will skip
creating the test-case variable and return a warning naming the matching project variable.
This means the test case will resolve that value from the project config at runtime — no
action is required on your part. When you see such a warning in the MCP response, inform
the user which project variable is being reused and confirm the step reference
(`{{VAR_NAME}}`) still resolves correctly at the project level.

### 5. Case Writing Standards

**Understand the Business Context First:**
Before writing test data, understand the product's business domain. If testing an
e-commerce site, use realistic product names, prices, and categories. If testing a
healthcare app, use appropriate medical terminology. Ask about the product's domain if
not obvious from the context.

**Step Writing Rules** (Midscene best practices):
- Use natural language, describe visible UI elements
- Prefix verification steps with Verify/Assert/Check/Confirm/Ensure/Validate
- Batch related sub-actions into single steps
- Use `{{VARIABLE}}` for config references
- Each step targets a specific browser/Android target ID

**Realistic Test Data:**
- Always use realistic, domain-appropriate test data — not "test123" or "lorem ipsum"
- For email fields: use realistic emails like `john.smith@company.com` (not `test@test.com`)
- For names: use common real names appropriate to the product's locale
- For addresses, phone numbers, etc.: use realistic formats
- For error testing: use realistic invalid inputs that real users might enter
- The goal is to find bugs that occur in real-world scenarios

**Static vs Dynamic Assertions:**
- **Static UI elements** (menu tab names, page titles, table column headers, form field
  labels, button text, navigation items) → assert exact text:
  `Verify the page title is 'Account Settings'`
  `Verify the table has columns 'Name', 'Email', 'Status', 'Actions'`
- **Dynamic/temporary data** (user-generated content, timestamps, counts, search results,
  notification messages with dynamic values) → use generic/pattern descriptions:
  `Verify a success notification is displayed`
  `Verify the order list shows at least one order`
  `Verify the user profile section displays an email address`
- When unsure if content is static or dynamic, prefer generic description

**Config Rules:**
- Names: `UPPER_SNAKE_CASE` only
- Use `VARIABLE` type for credentials (with `masked: true` for passwords)
- Use `URL` type for base URLs
- Use `RANDOM_STRING` for unique test data (e.g., unique usernames per run)
- Use `configs` or `variables` for test-case variables (both are accepted by MCP create tool)
- Do not send `FILE` variables in create payload; handle file upload separately after creation

**Target Config:**
- Browser: `{ type: "browser", url: "...", width: 1920, height: 1080 }`
- Android: `{ type: "android", deviceSelector: {}, appId: "...", clearAppState: true, allowAllPermissions: true }`

### 6. Final Report

After iterating through all cases one-by-one, summarize:
- Created cases (confirmed and created)
- Skipped cases
- Cases needing more clarification
- Recommended next test priorities

## Guidelines

- Always understand flows FIRST, then design and create test cases.
- Treat this as a 2-step workflow:
  1. Study and confirm the end-to-end user flow(s) step-by-step (entry URL/App ID -> login -> key flow steps)
  2. Design and create test cases one-by-one with user confirmation before each creation
- **ALWAYS wait for explicit user confirmation** ("ok", "confirm", "yes", "go ahead")
  before proceeding. Never auto-proceed. Mandatory checkpoints:
  1. After presenting identified end-to-end user flows
  2. Before creating each individual test case
- Never present all test cases as a full approval batch.
- Never create multiple test cases in one MCP create call while using this skill.
- Always call MCP create tool with single payload shape:
  `create_test_cases({ projectId, testCase: { ... } })`
- **Understand authentication before anything else** — know the login mechanism, entry
  point, roles, and test credentials before studying any feature flow.
- **Never guess a step** — if any step in a flow is unclear (unknown UI, dialog behavior,
  redirect target, error message text), do not fill it in. Either ask the user to connect
  a browser agent for live exploration, or ask the user a direct question to fill the gap.
  A flow is only ready to present when every step is fully known.
- **Request live browser exploration when needed** — if provided screenshots or
  descriptions are insufficient to derive the complete end-to-end flow, ask the user to
  connect a browser agent. Do not proceed with partial understanding.
- **Understand the product's business context** — ask about the domain if not obvious.
  Use domain-appropriate terminology and realistic data in all test cases.
- **Realistic test data**: Use real-world-like values (real names, proper email formats,
  domain-appropriate product names/prices). Never use "test123", "foo@bar.com", or
  placeholder text. The goal is finding bugs that occur in production scenarios.
- **Static vs dynamic assertions**: Assert exact text for static UI (menu names, column
  headers, page titles, labels). Use generic descriptions for dynamic content (user data,
  timestamps, counts, notification messages with variable values).
- Prefer fewer, well-structured steps over many granular steps
- Reuse existing project-level configs when possible
- Set `masked: true` for any sensitive values (passwords, tokens, API keys)
- Use descriptive `displayId` values (e.g., "LOGIN-001", "CHECKOUT-003")
- Default to browser targets unless user specifies Android
- Default viewport: 1920×1080 for browser targets

## Example: Complete Test Case

```json
{
  "projectId": "proj_123",
  "testCase": {
    "name": "Login - Happy Path",
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
        "action": "Fill in the email field with '{{LOGIN_EMAIL}}' and the password field with '{{LOGIN_PASSWORD}}'",
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
        "action": "Verify the page displays the Dashboard heading",
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

### Create Call Checklist

Before each MCP create call, confirm the payload includes:
- one case only (`testCase`, never array/batch)
- resolved target IDs used consistently in every step `target`
- complete target definitions (browser/android) for all referenced targets
- all required variables used by `{{...}}` in steps, including masked ones (include them with `value: ""` and `masked: true` so SkyTest creates the slot)
- if the server skips a variable due to a matching project config, verify the `{{VAR_NAME}}` reference resolves at the project level and inform the user
- step `type` set correctly for AI vs code steps
- no `FILE` variable in create payload

If any item is missing, fix before calling MCP.

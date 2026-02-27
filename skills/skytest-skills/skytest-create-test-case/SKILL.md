---
name: skytest-create-test-case
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

### 4. Review and Create One Test Case at a Time

For each candidate test case, follow this loop:

1. Draft exactly ONE test case (title, priority, steps, assertions, configs, targets).
2. Present only that one test case to the user for review.
3. Ask for explicit decision: confirm/create, clarify/modify, or skip.
4. If user confirms, create only that single case via MCP.
5. If user asks to modify, revise and re-present the same case.
6. If user skips, do not create it; move to the next case.

**Creation rule:** never create in batch when running this skill.
Call `create_test_cases` with a single `testCase` object each time:
`{ projectId, testCase: { ...all case details... } }`.

**All-details creation rule:** each confirmed case must include:
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
- Use `VARIABLE` type for credentials (with `masked: true` for passwords)
- Use `URL` type for base URLs
- Use `RANDOM_STRING` for unique test data (e.g., unique usernames per run)
- Use `configs` or `variables` for test-case variables (both are accepted by MCP create tool)
- Do not send `FILE` variables in create payload; handle file upload separately after creation

#### Target Config

- Browser: `{ type: "browser", url: "...", width: 1920, height: 1080 }`
- Android: `{ type: "android", deviceSelector: {}, appId: "...", clearAppState: true, allowAllPermissions: true }`

### 6. Final Report

After iterating through all cases one-by-one, summarize:
- Created cases by priority level (P0/P1/P2/P3)
- Skipped cases and reasons
- Cases needing more clarification
- Gaps in coverage — flows or risk areas not yet covered
- Recommended next test priorities

## Guidelines

- Always understand flows FIRST, then design and create test cases.
- Treat this as a 2-step workflow:
  1. Study and confirm the end-to-end user flow(s) step-by-step
  2. Design and create test cases one-by-one with user confirmation before each creation
- **ALWAYS wait for explicit user confirmation** ("ok", "confirm", "yes", "go ahead")
  before proceeding. Never auto-proceed. Mandatory checkpoints:
  1. After presenting identified end-to-end user flows
  2. Before creating each individual test case
- **Design P0 cases first** — always start with the highest business-risk flows
- **Every test case must be independent** — runnable in isolation, no implicit state
  dependencies on other cases
- Never present all test cases as a full approval batch.
- Never create multiple test cases in one MCP create call while using this skill.
- Always call MCP create tool with single payload shape:
  `create_test_cases({ projectId, testCase: { ... } })`
- **Understand authentication before anything else** — know the login mechanism, entry
  point, roles, and test credentials before studying any feature flow.
- **Never guess a step** — if any step in a flow is unclear (unknown UI, dialog behavior,
  redirect target, error message text), do not fill it in. Either ask the user to connect
  a browser agent for live exploration, or ask the user a direct question to fill the gap.
- **Request live browser exploration when needed** — if provided screenshots or
  descriptions are insufficient to derive the complete end-to-end flow, ask the user to
  connect a browser agent. Do not proceed with partial understanding.
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

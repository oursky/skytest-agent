---
name: skytest-2-plan
description: >
  Design prioritized test cases from a UI skeleton document produced by
  skytest-1-explore. Classifies flows by business risk, designs happy path
  and edge case coverage, and produces a step-by-step test plan referencing
  specific UI elements. Output feeds into skytest-3-tools for MCP execution.
  Use when the user has a UI skeleton and wants to design test cases before
  creating them in SkyTest.
---

# SkyTest Plan Skill

Design test cases with risk-based prioritization from a UI skeleton.

## Non-Negotiable Rules

- **Never guess a UI step** — if the skeleton is unclear about an element's label, type, or location, ask the user or suggest re-running `/skytest-1-explore` for that screen.
- **Never design test cases for un-automatable flows** without explicitly flagging them (see Automation Boundaries below).
- **Every test case must be self-contained** — no test depends on another test having run first.
- **Do not proceed to `/skytest-3-tools`** until the user explicitly confirms the test plan.
- **Never force a test case that can't be fully automated.** If a step requires something outside SkyTest's capabilities, flag it honestly and suggest manual testing.

## Input

Expects a **UI skeleton document** from `/skytest-1-explore`. The skeleton must include:
- Screens with interactive elements and display elements
- Navigation flow between screens
- Authentication details, login flow selectors, and login Playwright code (if browser-verified)
- Any automation flags

If the user doesn't have a skeleton, either:
1. Suggest running `/skytest-1-explore` first, or
2. Accept equivalent information (screenshots + written descriptions) and work from that — but note that coverage quality depends on input completeness.

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
- CAPTCHA challenges (image, reCAPTCHA, hCaptcha) — blocks both exploration and automated test execution
- File upload fields requiring actual file input (not supported via SkyTest MCP)
- Multi-tab or new-window flows (SkyTest executes within a single browser context — tab/window switching may not be supported)
- Iframe-embedded content (automation reliability varies — flag for the user's awareness)

**When you encounter these:**
1. Do NOT design a test case that includes the un-automatable step — it will fail every run.
2. Tell the user clearly: "This step requires [email/OTP/etc.] which SkyTest can't automate."
3. Suggest splitting the flow: automate what you can (everything before and after the manual step), and recommend the user test the un-automatable part manually.
4. If an entire scenario is un-automatable, skip it and note it as "recommended for manual testing" in the test plan.

**CAPTCHA-specific:** If the login or any critical flow includes a CAPTCHA, warn the user that both exploration and automated test execution will be blocked. Confirm whether they still want to create test cases knowing this limitation.

## Workflow

### 1. Understand Business Context

Before designing test cases, establish:
- What domain is this product in? (e-commerce, healthcare, SaaS, fintech, etc.)
- Who are the target users of this section?
- What are the core business workflows in this section?
- Which flows affect revenue, security, or compliance?

This context drives:
- Priority classification (P0-P3)
- Realistic test data choices (domain-appropriate, not generic)
- Which edge cases matter most

### 2. Classify Flows by Business Risk

From the UI skeleton's screens and navigation flow, identify all testable flows and classify:

- **P0 — Revenue / Security / Compliance**: Payments, authentication, authorization, personal data handling. Failure = business loss or legal exposure.
- **P1 — Core User Journeys**: Primary daily workflows the section supports. Failure = users blocked from core tasks.
- **P2 — Error Handling & Edge Cases**: Input validation, error recovery, boundary conditions. Failure = degraded experience.
- **P3 — Polish & Rare Scenarios**: Unusual inputs, cosmetic issues, rare configurations. Failure = minor inconvenience.

**Present the classification to the user.** Ask what coverage depth they want — e.g., "P0-P1 only for now" or "full P0-P3." This avoids designing 20+ cases when the user only wants the critical paths first. Design cases starting from the agreed priority level downward. The user may adjust priorities or skip lower tiers entirely.

### 3. Design Test Cases

For each flow, apply structured test design:

- **Happy path**: Standard successful flow as described in the skeleton
- **Input validation**: Invalid, empty, boundary-length, and special-character inputs per field (reference the skeleton's form field types)
- **Business rule enforcement**: Constraints the system must enforce (empty cart, duplicate entries, required fields, min/max values)
- **State transitions**: Back button, page refresh, double-click submit, session expiry mid-flow
- **Error recovery**: User triggers error, corrects input, completes flow without restarting
- **Authorization boundaries**: Users cannot access resources beyond their role (if roles exist in the skeleton)

**Before designing each test case, check:** Can every step be fully automated inside the browser or APK? If a flow involves email, OTP, CAPTCHA, file upload, third-party payment, or any un-automatable step, flag it immediately. Don't design a test case you know will fail.

**If test cases already exist for this section** (the user mentions them or they were found via `/skytest-3-tools`), prefer updating existing cases over creating duplicates. Note in the plan which cases are updates vs. new.

### 4. Ensure Test Independence

Every test case must be self-contained:
- Starts from the entry point (URL or app launch)
- Includes its own login steps if the section requires authentication
- Does not depend on another test case having run first
- Notes any preconditions requiring manual data setup (e.g., "requires at least one existing record in the list")

**Fixture-only entities**: If `/skytest-1-explore` flagged any entity as fixture-only (create/edit permissions restricted), do not design test cases that attempt to create those entities. Design around reading or modifying pre-existing records only, and state the required fixture in the Preconditions block.

### 5. Adopt Login Step from UI Skeleton

The login step is the first step in most test cases. Its accuracy depends on how it was captured during `/skytest-1-explore`.

#### When the skeleton includes login Playwright code (`Verified: yes`)

The UI skeleton from `/skytest-1-explore` includes Playwright code for the login flow, recorded and verified via Playwright MCP. **Adopt it as-is** — include it verbatim as a single `playwright-code` Step 1. Do not modify the selectors or assertions.

#### When the skeleton does NOT have Playwright code (`Verified: no` or missing)

**Do NOT attempt to generate Playwright code.** Guessing selectors produces code that fails at runtime — a test case that fails every run is worse than one that uses AI actions.

Fall back to `ai-action` steps for login:
```
1. [LOGIN] Navigate to {{BASE_URL}}/login
2. [LOGIN] Fill "Email address" with {{LOGIN_EMAIL}} and "Password" with {{LOGIN_PASSWORD}}
3. [LOGIN] Click "Sign In"
4. [LOGIN] Verify "Welcome back" is visible
```

Note in the plan: "Login uses ai-action — selectors were not verified. To upgrade to playwright-code, re-run `/skytest-1-explore` with Playwright MCP connected for the login flow."

#### Reuse across test cases

Once the login step (playwright-code or ai-action) is established, **reuse it identically** as Step 1 in every test case that requires authentication. Do not re-design the login per test case.

### 6. Design Remaining Steps

For each test case, write concrete steps that reference **exact UI element labels from the skeleton**.

**Step tags** — prefix each step with a category tag:
- `[LOGIN]` — authentication steps (usually a single playwright-code step or ai-action sequence)
- `[NAV]` — navigation to the target screen
- `[ACTION]` — user interaction (click, fill, select, scroll)
- `[ASSERT]` — verification of expected state

**Step type hints** — note which steps should use `ai-action` vs `playwright-code`:
- **playwright-code**: Login flows (when verified selectors available), sidebar/menu navigation with ambiguous labels, dropdown selection, any step the user provides explicit code for
- **ai-action**: Login flows (when selectors NOT verified), everything else (form fills, button clicks, assertions, scrolling)

**Atomic steps** — each step does one thing. Never combine verify + action + verify in a single step. Split into:
1. Verify pre-condition
2. Perform action
3. Verify post-condition

**Viewport awareness** — for pages with 8+ fields, checkbox matrices, or action buttons at the bottom, plan explicit scroll steps. Verify above-fold content, scroll, then verify below-fold content.

**Use `{{VARIABLE}}` placeholders** for all configurable values (credentials, URLs, test data that varies per environment).

### 7. Apply Assertion Depth

Verify *consequences*, not just appearance:
- **After create**: Item appears in list/table, not just success toast
- **After delete**: Item gone from list, not just confirmation dismissed
- **After form submit**: Data reflected on detail page, not just form closed
- **After login**: User identity shown in header, not just URL changed
- **After error**: Specific error message displayed, previously entered data preserved

**Exact vs generic assertions — match the user's intent:**
- Static UI elements (labels, titles, headers) — assert exact text
- Static data the user explicitly wants checked — assert exact values
- Dynamic content that changes each session (timestamps, row counts) — assert presence or format only
- When unsure, ask the user

**Form default states:** Check actual defaults from the skeleton's "Defaults & Pre-filled State" section. Don't assume all checkboxes are unchecked.

### 8. Choose Context-Driven Test Data

Test data should come from the user's actual context, not generic templates.

**Sources (in priority order):**
1. Screenshots or skeleton — extract specific records, IDs, values visible in the UI
2. Feature descriptions — use actual field names, entity types, and business terms
3. Existing project configs — reuse variables that already contain real test data
4. The user directly — ask for realistic values they use in their environment
5. Domain-appropriate realistic data — only when no context is available

**Never use** "test123", "foo@bar.com", or "Lorem ipsum". For error paths, use realistic invalid inputs (typos, too-short passwords, text in number fields).

### 9. Establish Test Data Conventions

Before writing test case steps, establish and **present these conventions to the user for confirmation**. Getting conventions wrong requires updating every test case after the fact.

**Unique field strategy**: Identify fields that must be unique across runs (e.g., email addresses, codes, usernames). The standard approach is a `RANDOM_STRING` variable with generation type `TIMESTAMP_DATETIME` (produces `YYYYMMDDHHmmssSSS`). **`{{TIMESTAMP}}` is NOT a built-in** — you must declare it as a test-case variable of type `RANDOM_STRING` with value `TIMESTAMP_DATETIME` (or `TIMESTAMP_UNIX` / `UUID`). Every `{{VAR}}` placeholder in step text requires a matching variable.

**Naming prefix**: Agree on a prefix for QA-created records to distinguish them from real data in shared environments (e.g., a "QA" or initials prefix on names and codes).

**Fixture vs. generated data**:
- **Generated per run** — records the test creates fresh. Use `RANDOM_STRING` variables for unique values. Note which entities fall here.
- **Fixture data** — pre-existing records the test reads or edits. Specify exact IDs, emails, or conditions required. Entities flagged as fixture-only by `/skytest-1-explore` always fall here — confirm the safe record range with the user.

**Browser target name**: Confirm the name that will be used for the browser target across all test cases (e.g., "Admin Portal", "Customer App"). This is set once and reused in every case.

**Viewport size**: Suggest a viewport based on the target website (e.g., 1920x1080 for desktop admin panels, 1366x768 for typical laptop displays, 390x844 for mobile). Confirm with the user — all test cases in this section will use this viewport.

**Starting URL**: Confirm whether test cases start at the app root or a specific entry path.

**Credential variables**: Confirm `LOGIN_EMAIL`, `LOGIN_PASSWORD` (or equivalent) will be configured as project-level variables. These must never be hardcoded in steps.

**Present this as a summary and wait for explicit user confirmation before proceeding to step 10.**

### 10. Produce Test Plan Document

Assemble all test cases into the output format below. Present to the user for review.

Ask: "Does this test plan cover the right scenarios? Any cases to add, modify, or skip?"

**Iterate until the user confirms the test plan.**

## Output Format

```markdown
# Test Plan: [Section Name]

**Source skeleton:** [link or filename of UI skeleton, or "provided by user"]
**App:** [App name]
**Platform:** Browser | Android
**Base URL:** [URL]
**Date:** [YYYY-MM-DD]

## Business Context

- **Domain:** [e.g., e-commerce, healthcare, SaaS]
- **Target users:** [who uses this section]
- **Critical flows:** [revenue/security/compliance impacts]

## Test Data Conventions

- **Browser target name:** [e.g., "Admin Portal"]
- **Viewport size:** [e.g., 1920x1080 — confirmed with user]
- **Starting URL:** [app root or specific entry path]
- **Credential variables:** LOGIN_EMAIL, LOGIN_PASSWORD (project-level — never hardcoded)
- **Unique field strategy:** [e.g., RANDOM_STRING variable `TIMESTAMP` with generation type `TIMESTAMP_DATETIME`, used as `{{TIMESTAMP}}` suffix on codes and names]
- **Naming prefix:** [e.g., "QA" prefix on all QA-created record names]
- **Generated per run:** [list entity types created fresh by tests]
- **Fixture-only:** [list entity types requiring pre-existing records + safe record range]

*(User confirmed: yes | pending)*

## Login Step

**Type:** playwright-code | ai-action
**Source:** UI skeleton from `/skytest-1-explore`
**Selectors verified:** yes | no

(If playwright-code, copy the login code from the UI skeleton's **Login Playwright Code** section. All test cases reference it as Step 1.)

```javascript
// Copied from UI skeleton — do not modify
await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
await page.getByRole('textbox', { name: 'Email address' }).fill(vars['LOGIN_EMAIL']);
await page.getByRole('textbox', { name: 'Password' }).fill(vars['LOGIN_PASSWORD']);
await page.getByRole('button', { name: 'Sign In' }).click();
await expect(page.getByText('Welcome back')).toBeVisible();
```

(If ai-action, include the natural language steps instead.)

## Test Cases

### TC-1: [Section] Short Description
**ID:** [XXXX-YY-ZZZ or user's convention]
**Priority:** P0 | P1 | P2 | P3
**Category:** Happy path | Validation | Edge case | Error recovery | Authorization

**Preconditions:**
- [any data or state needed before test starts, or "None"]

**Steps:**
1. [LOGIN] (login step from above)
2. [NAV] Click "Settings" in the sidebar
3. [ACTION] Click the "Edit Profile" button
4. [ACTION] Clear the "Display Name" field and type "{{TEST_DISPLAY_NAME}}"
5. [ACTION] Click "Save Changes"
6. [ASSERT] Verify success toast "Profile updated" appears
7. [ASSERT] Verify "Display Name" field shows "{{TEST_DISPLAY_NAME}}"

**Step type hints:**
- Step 1: playwright-code (login — verified selectors) | ai-action (login — unverified)
- Step 2: playwright-code (sidebar navigation)
- Steps 3-7: ai-action

**Variables (test-case level only):**
| Name | Type | Value (generation type) | Masked | Notes |
|------|------|------------------------|--------|-------|
| TEST_DISPLAY_NAME | RANDOM_STRING | TIMESTAMP_DATETIME | no | unique per run; generation types: `TIMESTAMP_DATETIME`, `TIMESTAMP_UNIX`, or `UUID` |

**Reuses from project:** BASE_URL, LOGIN_EMAIL, LOGIN_PASSWORD

### TC-2: [Section] Short Description
(same structure repeats)

## Coverage Summary

| Priority | Count | Categories |
|----------|-------|------------|
| P0 | 2 | Happy path, Authorization |
| P1 | 3 | Happy path, Validation |
| P2 | 2 | Edge case, Error recovery |

## Manual Testing Recommendations

- [Flow X] requires email verification — cannot automate step N
- (or: "All designed test cases are fully automatable")

## Gaps & Future Coverage

- [Area not covered and why]
- [Suggested follow-up test cases for future rounds]
```

### ID Convention

Use the format the user has established. If no convention exists, **ask the user for their preferred ID pattern.** The default is `XXXX-YY-ZZZ`:
- `XXXX` — 2-4 uppercase letters, a short-form abbreviation of the target page or feature (e.g., `AUTH` for authentication, `NEWS` for news management, `PAY` for payments)
- `YY` — 2-digit section number representing a distinct section on the page (e.g., `01`, `02`, `03`). All test cases in the same section share the same `[Section]` title prefix
- `ZZZ` — 3-digit zero-padded test case number within that section (e.g., `001`, `002`, `003`)

Examples: `AUTH-01-001`, `AUTH-01-002` (both in `[Login]` section), `AUTH-02-001` (in `[Password Reset]` section), `NEWS-01-001` (in `[Article List]` section).

Once established, follow the convention exactly.

### Name Format

Every test case name must follow: `[Section] Short description` (e.g., `[Auth] Login Happy Path`, `[Settings] Update Display Name`).

## Next Step

Once the user confirms the test plan, suggest: **"Run `/skytest-3-tools` with this test plan to create the test cases in SkyTest."**

If the user wants to add coverage for another section, suggest running `/skytest-1-explore` for the new section first.

---
name: skytest-2-plan
description: >
  Design prioritized test cases from a UI skeleton document produced by
  skytest-1-learn. Classifies flows by business risk, designs happy path
  and edge case coverage, and produces a step-by-step test plan referencing
  specific UI elements. Output feeds into skytest-3-manage for MCP execution.
  Use when the user has a UI skeleton and wants to design test cases before
  creating them in SkyTest.
---

# SkyTest Plan Skill

Design test cases with risk-based prioritization from a UI skeleton.

## Non-Negotiable Rules

- **Never guess a UI step** — if the skeleton is unclear about an element's label, type, or location, ask the user or suggest re-running `/skytest-1-learn` for that screen.
- **Never design test cases for un-automatable flows** without explicitly flagging them (see Automation Boundaries below).
- **Every test case must be self-contained** — no test depends on another test having run first.
- **Do not proceed to `/skytest-3-manage`** until the user explicitly confirms the test plan.
- **Never force a test case that can't be fully automated.** If a step requires something outside SkyTest's capabilities, flag it honestly and suggest manual testing.

## Input

Expects a **UI skeleton document** from `/skytest-1-learn`. The skeleton must include:
- Screens with interactive elements and display elements
- Navigation flow between screens
- Authentication details and login flow selectors (if captured)
- Any automation flags

If the user doesn't have a skeleton, either:
1. Suggest running `/skytest-1-learn` first, or
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

**When you encounter these:**
1. Do NOT design a test case that includes the un-automatable step — it will fail every run.
2. Tell the user clearly: "This step requires [email/OTP/etc.] which SkyTest can't automate."
3. Suggest splitting the flow: automate what you can (everything before and after the manual step), and recommend the user test the un-automatable part manually.
4. If an entire scenario is un-automatable, skip it and note it as "recommended for manual testing" in the test plan.

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

**Present the classification to the user.** Design cases starting from P0 downward. The user may adjust priorities or skip P3 entirely.

### 3. Design Test Cases

For each flow, apply structured test design:

- **Happy path**: Standard successful flow as described in the skeleton
- **Input validation**: Invalid, empty, boundary-length, and special-character inputs per field (reference the skeleton's form field types)
- **Business rule enforcement**: Constraints the system must enforce (empty cart, duplicate entries, required fields, min/max values)
- **State transitions**: Back button, page refresh, double-click submit, session expiry mid-flow
- **Error recovery**: User triggers error, corrects input, completes flow without restarting
- **Authorization boundaries**: Users cannot access resources beyond their role (if roles exist in the skeleton)

**Before designing each test case, check:** Can every step be fully automated inside the browser or APK? If a flow involves email, OTP, third-party payment, or any un-automatable step, flag it immediately. Don't design a test case you know will fail.

### 4. Ensure Test Independence

Every test case must be self-contained:
- Starts from the entry point (URL or app launch)
- Includes its own login steps if the section requires authentication
- Does not depend on another test case having run first
- Notes any preconditions requiring manual data setup (e.g., "requires at least one existing record in the list")

### 5. Generate Login Step

The login step is the first step in most test cases. It must be accurate because every test case reuses it.

#### When the skeleton has verified login selectors (`Verified: yes`)

Generate a **single `playwright-code` step** that covers the entire login flow. Build the code directly from the Login Flow Selectors table — each row maps to one Playwright call:

| Selector Action | Playwright Code |
|-----------------|----------------|
| `assert` heading "X" | `await expect(page.getByRole('heading', { name: 'X' })).toBeVisible();` |
| `assert` text "X" | `await expect(page.getByText('X')).toBeVisible();` |
| `fill` textbox "X" → VAR | `await page.getByRole('textbox', { name: 'X' }).fill(vars['VAR']);` |
| `click` button "X" | `await page.getByRole('button', { name: 'X' }).click();` |
| `click` link "X" | `await page.getByRole('link', { name: 'X' }).click();` |
| `click` text "X" | `await page.getByText('X').click();` |

**Rules for login Playwright code:**
- Walk through each state in order, translating every row to its Playwright equivalent
- Insert `await expect(...).toBeVisible()` assertions **between screen transitions** to confirm the next state loaded before interacting with it
- Use `vars['VARIABLE_NAME']` for all credential values — never hardcode
- End with a post-login assertion (e.g., `await expect(page.getByText('Hi, User')).toBeVisible();`)
- Use `{ name: 'X' }` with the **exact text** from the selector table — do not paraphrase or translate
- Use `{ exact: true }` when the name could partially match other elements on the page

**Example** (from a multi-step login with ID → password → OTP):

```javascript
await expect(page.getByText('登入平台管理系統')).toBeVisible();
await page.getByText('登入').click();
await expect(page.getByRole('heading', { name: '登入管理系統' })).toBeVisible();
await page.getByRole('textbox', { name: '員工編號' }).fill(vars['LOGIN_ID']);
await page.getByRole('button', { name: '登入' }).click();
await expect(page.getByRole('heading', { name: '輸入密碼' })).toBeVisible();
await page.getByRole('textbox', { name: '目前密碼' }).fill(vars['LOGIN_PW']);
await page.getByRole('button', { name: '繼續' }).click();
await expect(page.getByRole('heading', { name: '驗證碼', exact: true })).toBeVisible();
await page.getByRole('textbox').click();
await page.getByRole('textbox').fill(vars['LOGIN_FIXED_OTP']);
await expect(page.getByText('Hi, User')).toBeVisible();
```

#### When the skeleton does NOT have verified selectors (`Verified: no` or missing)

**Do NOT attempt to generate Playwright code.** Guessing selectors from screenshots produces code that fails at runtime — a test case that fails every run is worse than one that uses AI actions.

Fall back to `ai-action` steps for login:
```
1. [LOGIN] Navigate to {{BASE_URL}}/login
2. [LOGIN] Fill "Employee ID" with {{LOGIN_ID}}, click "Login"
3. [LOGIN] Fill "Password" with {{LOGIN_PW}}, click "Continue"
4. [LOGIN] Fill OTP field with {{LOGIN_FIXED_OTP}}
5. [LOGIN] Verify "Hi, User" is visible
```

Note in the plan: "Login uses ai-action — selectors were not verified. To upgrade to playwright-code, re-run `/skytest-1-learn` with a browser tool for the login flow."

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

### 9. Produce Test Plan Document

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

## Login Step

**Type:** playwright-code | ai-action
**Selectors verified:** yes | no

(If playwright-code, include the full code block here once. All test cases reference it as Step 1.)

```javascript
// Example — only include if selectors are verified
await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
await page.getByRole('textbox', { name: 'Email address' }).fill(vars['LOGIN_EMAIL']);
await page.getByRole('textbox', { name: 'Password' }).fill(vars['LOGIN_PASSWORD']);
await page.getByRole('button', { name: 'Sign In' }).click();
await expect(page.getByText('Welcome back')).toBeVisible();
```

(If ai-action, include the natural language steps instead.)

## Test Cases

### TC-1: [Section] Short Description
**ID:** [XXXXX-NNN or user's convention]
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
| Name | Type | Example Value | Masked | Notes |
|------|------|---------------|--------|-------|
| TEST_DISPLAY_NAME | RANDOM_STRING | — | no | unique per run |

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

Use the format the user has established. If no convention exists, **ask the user for their preferred ID pattern.** The default is `XXXXX-NNN`: 5 uppercase letters derived from the section/feature name + hyphen + 3-digit zero-padded sequence (e.g., `LOGIN-001`, `PAYMT-002`). Users may prefer different patterns like `CMS-02-001`. Once established, follow it exactly.

### Name Format

Every test case name must follow: `[Section] Short description` (e.g., `[Auth] Login Happy Path`, `[Settings] Update Display Name`).

## Next Step

Once the user confirms the test plan, suggest: **"Run `/skytest-3-manage` with this test plan to create the test cases in SkyTest."**

If the user wants to add coverage for another section, suggest running `/skytest-1-learn` for the new section first.

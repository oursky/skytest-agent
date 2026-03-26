---
name: skytest-1-explore
description: >
  Explore a target web or mobile app section, produce a structured UI skeleton
  document, and generate verified Playwright login code when browser tools are
  available. Use when starting test coverage for a new feature or section. Accepts
  input from Chrome DevTools MCP, browser-use CLI, Claude in Chrome, or user-provided
  screenshots. Output feeds into skytest-2-plan for test case design.
---

# SkyTest Explore Skill

Explore the target app section, produce a structured UI skeleton document, and generate verified login Playwright code.

## Non-Negotiable Rules

- **Never attempt to read, download, or process video files** (`.mov`, `.mp4`, `.webm`, `.avi`, `.mkv`) — they burn through context tokens and cannot be processed. Ask for screenshots or text descriptions instead.
- **Study only the section the user specifies**, not the entire app. Always ask or confirm which section to focus on before starting. Studying the whole app wastes tokens and produces an unfocused skeleton.
- **Never assume UI structure** — verify every element from actual app observation (screenshots, DOM inspection, or browser automation output).
- **Always identify the authentication flow first** before studying any feature screens.

## Input Methods

### Method Selection

Ask the user which method is available, or detect from the tool environment:

1. **User-provided screenshots** — always available, most token-efficient
2. **Claude in Chrome** — if the user has the Claude Chrome extension active
3. **Chrome DevTools MCP** — if a Chrome DevTools Protocol MCP server is connected
4. **browser-use CLI** — if `browser-use` or equivalent browser CLI is installed
5. **Playwright MCP** — if a Playwright MCP server is connected (richest data but highest token cost)

If multiple methods are available, prefer the most **token-efficient** option that still captures enough detail. Methods are listed above from most to least efficient. Only escalate to a heavier method when a lighter one cannot capture the information needed (e.g., complex dynamic UIs where screenshots miss hidden elements). Always offer screenshots as a supplement to any automated method.

### Method A: User-Provided Screenshots (Most Efficient)

**How:**
1. Ask the user for screenshots of each screen in the target section
2. Guide them on what to capture:
   - Entry screen (with URL visible if possible)
   - Each distinct screen or state in the flow
   - Form states (empty + filled + error states if relevant)
   - Navigation menus that lead to/from the section
   - Any modal dialogs or dropdown menus in expanded state
3. For long pages, request both top-of-page and scrolled-down captures

**Minimum required:** Entry screen + key interaction screens + result/confirmation screens.

### Method B: Claude in Chrome Extension

**When:** The user has the Claude Chrome extension active and can browse the target app.

**How:**
1. Ask the user to navigate to the section's entry point
2. Request the user share the page context via the extension
3. Study the DOM structure and visible elements from the shared context
4. Ask the user to navigate to each subsequent screen and share again
5. Supplement with screenshots if the extension context is incomplete

**Capture:** Page content, DOM structure, visible elements, screenshots via extension sharing.

### Method C: Chrome DevTools MCP

**When:** A Chrome DevTools Protocol MCP server is connected to the agent session.

**How:**
1. Navigate to the target section's entry URL
2. Use DOM inspection tools to extract the page structure
3. Identify interactive elements (inputs, buttons, links, dropdowns, toggles)
4. Identify display elements (headings, labels, data fields, tables, status indicators)
5. Capture screenshots at each screen state for visual reference
6. Navigate through the section, repeating for each screen

**Capture:** Page URLs, element selectors, visible labels, form fields, element types, navigation structure.

### Method D: browser-use CLI

**When:** A browser automation CLI tool (e.g., `browser-use` or similar) is available.

**How:**
1. Launch the browser with the target URL
2. Navigate through each screen in the section
3. Capture full-page screenshots at each step
4. Extract visible text, element labels, and navigation paths
5. Note form field types and any visible defaults or placeholder text

**Capture:** Screenshots at each navigation step, visible text and labels, URL changes, page transitions.

### Method E: Playwright MCP (Richest Data, Highest Token Cost)

**When:** A Playwright MCP server (e.g., `@anthropic-ai/playwright-mcp` or `@playwright/mcp`) is connected to the agent session. Use only when lighter methods cannot capture the needed detail — accessibility tree snapshots are verbose and consume significantly more context tokens.

**How:**
1. Use `browser_navigate` to go to the target section's entry URL
2. Use `browser_snapshot` to capture the page's accessibility tree — this gives the richest structural view of all interactive and display elements with their roles, names, and states
3. Use `browser_screenshot` to capture a visual reference of each screen
4. Identify interactive elements from the accessibility tree (buttons, links, textboxes, comboboxes, checkboxes, etc.)
5. Identify display elements useful for assertions (headings, text, tables, status indicators)
6. Use `browser_click` or `browser_hover` to navigate through the section, repeating snapshot + screenshot for each screen
7. For pages with content below the viewport, use `browser_scroll` then re-snapshot

**Capture:** Accessibility tree with element roles/names/states, screenshots, page URLs, navigation structure. The accessibility snapshot is the most reliable source for exact element labels and types.

## Workflow

### 1. Establish Scope

Collect from the user:
- Which section or feature of the app to study
- Entry point URL (for browser) or app screen name (for Android)
- Platform: browser or Android
- Any specific flows or sub-sections to focus on within the section

**Do not proceed without a clear, bounded scope.** If the user says "the whole app," push back: "Which section should we start with? Studying one section at a time produces better results and avoids burning through tokens."

### 2. Establish Authentication and Capture Login Flow

Before studying any feature screen, establish:
- How does the user log in? (email/password form, SSO, API key, magic link, etc.)
- What is the login URL or entry point?
- Are there multiple roles? Which role is needed for this section?
- What test credentials will be used?
- Is the login flow multi-step? (e.g., enter ID → enter password → enter OTP on separate screens)

Record these as future variable candidates: `LOGIN_EMAIL`, `LOGIN_PASSWORD`, etc.

If the user mentions an existing login test case or project-level credentials, note them for reuse — the actual variable creation happens later in `/skytest-3-tools`.

#### Login Flow Deep Capture

The login flow is the most reused step across all test cases. Accurate Playwright code for login requires **verified element selectors** — exact roles, names, and text from the DOM or accessibility tree. Screenshots show text labels but cannot confirm the semantic structure needed for reliable `getByRole` / `getByText` selectors.

**If a browser tool is available (Playwright MCP, Chrome DevTools MCP, or browser-use CLI):**
Even if using screenshots (Method A) for the rest of the section, **escalate to a browser tool for the login flow specifically.** The token cost is small (login is usually 1-3 screens) and the payoff is high (accurate Playwright code reused across every test case).

1. Navigate to the login entry point
2. At each login screen state, capture the **accessibility tree or DOM structure** — specifically:
   - Every interactive element's **role** (button, textbox, link, heading, etc.)
   - Every element's **accessible name** (the `name` attribute in the accessibility tree, or visible label)
   - Every heading and landmark text visible on screen (used for `expect` assertions between steps)
3. Perform each login action (fill credentials, click submit) and capture the **next screen state** before proceeding
4. Continue until login completes and the post-login landing page is reached
5. Record the final assertion target (e.g., a heading, a welcome message, or user identity in the nav bar)
6. Generate the login Playwright code immediately from the captured selectors — see **Generate Login Playwright Code** below

**If only screenshots are available:**
Capture screenshots of each login screen state. Record the visible text labels for each field, button, and heading. Note in the output that login selectors are **not verified** — `/skytest-2-plan` will use ai-action fallback for login steps.

The captured data goes into the **Login Flow Selectors** section of the UI skeleton output. When selectors are verified, also generate login Playwright code (see below).

#### Generate Login Playwright Code

When browser tool data has been captured for the login flow, **generate the Playwright code immediately** while the selectors are verified and the browser context is live. This is the most accurate moment to produce login code — the selectors are freshly captured from the actual DOM/accessibility tree, and any issues can be caught while the page is still open.

Build the code directly from the Login Flow Selectors table — each row maps to one Playwright call:

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

**If only screenshots were used for login:** Do not generate Playwright code. Note in the skeleton: "Login selectors not verified — `/skytest-2-plan` will use ai-action fallback for login steps."

Include the generated code in the **Login Playwright Code** section of the UI skeleton output.

### 3. Capture All Screens in Section

Using the chosen input method:

1. Start at the section's entry screen
2. For each screen, extract:
   - **Page identifier** — URL path or screen name
   - **How to reach it** — which element on the previous screen leads here
   - **Interactive elements** — every button, link, input, dropdown, toggle, checkbox, radio, tab, or other control the user can interact with
   - **Display elements** — headings, labels, data fields, table columns, status badges, toasts, alerts, or any content useful for assertions
   - **Element labels** — exactly as they appear in the UI (copy the text precisely)
   - **Form field types** — text, password, email, number, date, textarea, select, etc.
   - **Defaults and pre-filled state** — any checkboxes checked by default, dropdown default selections, pre-populated fields
3. Navigate to the next screen and repeat
4. Continue until all screens in the section have been captured

**If any screen is unclear or partially visible:** Ask the user for additional screenshots or clarification. Do not fill gaps with assumptions.

### 4. Map Navigation Flow

Document how screens connect:
- Which element on Screen A leads to Screen B
- Back/breadcrumb paths
- Sidebar or top-nav entries that provide direct access
- Any conditional navigation (e.g., different paths based on user role or data state)

### 5. Flag Automation Concerns

While studying screens, note any elements or flows that may not be automatable:
- Email verification or OTP entry screens
- Third-party auth popups leaving the app domain
- Payment flows (Stripe, PayPal, etc.)
- File download verification
- Backend-only validation with no visible UI indicator

These are flagged here for awareness — the full automation boundary rules are in `/skytest-2-plan`.

### 6. Produce UI Skeleton Document

Assemble all captured information into the output format below. Present it to the user for review.

Ask: "Does this skeleton accurately represent the section? Any screens missing? Any elements incorrect?"

**Iterate until the user confirms the skeleton is complete and accurate.**

## Output Format

```markdown
# UI Skeleton: [Section Name]

**App:** [App name or URL]
**Platform:** Browser | Android
**Date captured:** [YYYY-MM-DD]
**Method:** Chrome DevTools MCP | browser-use CLI | Claude in Chrome | User screenshots

## Authentication

- **Login URL/entry:** [URL or screen name]
- **Method:** [email/password | SSO | magic link | etc.]
- **Role needed:** [role name or "default"]
- **Credential variables:** LOGIN_EMAIL, LOGIN_PASSWORD

### Login Flow Selectors

**Source:** Playwright MCP accessibility snapshot | Chrome DevTools DOM | browser-use CLI | screenshots only
**Verified:** yes | no

(Include this section ONLY if browser tool data was captured for the login flow. If only screenshots were used, write: "**Verified:** no — selectors not verified, recommend ai-action fallback for login steps.")

#### State 1: [Screen title, e.g., "Login Entry"]
**URL:** /login
**Visible heading/landmark:** "登入平台管理系統"
| Action | Element Role | Element Name/Text | Variable |
|--------|-------------|-------------------|----------|
| assert | heading | "登入平台管理系統" | — |
| fill | textbox | "用戶編號" | LOGIN_ID |
| click | button | "登入" | — |

#### State 2: [Screen title, e.g., "Password Entry"]
**Visible heading/landmark:** "輸入密碼"
| Action | Element Role | Element Name/Text | Variable |
|--------|-------------|-------------------|----------|
| assert | heading | "輸入密碼" | — |
| fill | textbox | "目前密碼" | LOGIN_PW |
| click | button | "繼續" | — |

#### Post-login assertion
| assert | text | "Hi, User" | — |

(Repeat states as needed for multi-step login flows. Each state represents a distinct screen the user sees during login.)

### Login Playwright Code

(Include this section ONLY when `Verified: yes`. Generated from the selector tables above during exploration while the browser context was live — this is the most accurate moment to produce login code.)

```javascript
// Example — generated from verified selectors
await expect(page.getByText('登入平台管理系統')).toBeVisible();
await page.getByText('登入').click();
await expect(page.getByRole('heading', { name: '登入管理系統' })).toBeVisible();
await page.getByRole('textbox', { name: '用戶編號' }).fill(vars['LOGIN_ID']);
await page.getByRole('button', { name: '登入' }).click();
await expect(page.getByRole('heading', { name: '輸入密碼' })).toBeVisible();
await page.getByRole('textbox', { name: '目前密碼' }).fill(vars['LOGIN_PW']);
await page.getByRole('button', { name: '繼續' }).click();
await expect(page.getByRole('heading', { name: '驗證碼', exact: true })).toBeVisible();
await page.getByRole('textbox').fill(vars['LOGIN_FIXED_OTP']);
await expect(page.getByText('Hi, User')).toBeVisible();
```

(If `Verified: no`, omit this section entirely. `/skytest-2-plan` will use ai-action fallback for login steps.)

## Screens

### Screen 1: [Page/Screen Name]

**URL/path:** `/path` or `Screen Name`
**Reached from:** [navigation description — e.g., "Click 'Settings' in sidebar"]

#### Interactive Elements
| Element | Type | Label/Text | Notes |
|---------|------|------------|-------|
| Email field | text input | "Email address" | required |
| Password field | password input | "Password" | required, masked |
| Sign In button | button | "Sign In" | primary action |
| Forgot Password link | link | "Forgot password?" | goes to /forgot-password |

#### Display Elements (for assertions)
| Element | Type | Content/Pattern |
|---------|------|-----------------|
| Page heading | h1 | "Sign In to Your Account" |
| Error alert | alert | appears on invalid credentials, red text |

#### Defaults & Pre-filled State
- "Remember me" checkbox is unchecked by default
- (or: "No defaults observed")

### Screen 2: [Page/Screen Name]
(same structure repeats for each screen)

## Navigation Flow

```
[Screen 1: Login] --("Sign In" button)--> [Screen 2: Dashboard]
[Screen 2: Dashboard] --("Settings" in sidebar)--> [Screen 3: Settings]
[Screen 3: Settings] --(browser back)--> [Screen 2: Dashboard]
```

## Automation Flags

- **Screen N:** [element or flow] involves [email/OTP/third-party] — may not be automatable
- (or: "No automation concerns identified")
```

## Next Step

Once the user confirms the UI skeleton, suggest: **"Run `/skytest-2-plan` with this skeleton to design test cases."**

If the user wants to study another section, run this skill again for the next section before moving to planning.

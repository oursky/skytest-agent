# SkyTest Agent — MCP Integration Guide

## Overview

SkyTest Agent is a test case management and execution platform. External AI agents can
create, manage, and run test cases via MCP tools.

## Connection

- **Endpoint**: `POST {SKYTEST_URL}/api/mcp`
- **Auth**: `Authorization: Bearer sk_test_...` (generate in Settings > Agent API Keys)
- **Protocol**: MCP Streamable HTTP (stateless, JSON response mode)

## Available Tools

### list_projects
List all projects owned by the authenticated user.

### get_project
Get project details including project-level configs.
- `projectId` (string) — Project ID

### list_test_cases
List test cases in a project.
- `projectId` (string) — Project ID
- `status` (string, optional) — Filter by status: `DRAFT`, `PASS`, `FAIL`, etc.
- `limit` (number, optional) — Max results (default 50, max 100)

### get_test_case
Get full test case details: steps, configs, and last 5 runs.
- `testCaseId` (string) — Test case ID

### create_test_cases
Batch create test cases as DRAFT in a project, with optional inline configs.
- `projectId` (string) — Project ID
- `testCases` (array) — Array of test cases:
  - `name` (string) — Test case name
  - `displayId` (string, optional) — User-facing display ID (e.g. `LOGIN-001`)
  - `url` (string, optional) — Base URL for browser target
  - `prompt` (string, optional) — AI prompt (alternative to steps)
  - `steps` (array, optional) — Test steps (see Step Writing Guide)
  - `browserConfig` (object, optional) — Target configs keyed by target ID
  - `configs` (array, optional) — Inline test case configs

### update_test_case
Update a test case (name, steps, browserConfig, url, prompt). Resets status to DRAFT.
- `testCaseId` (string) — Test case ID
- `name`, `url`, `prompt`, `steps`, `browserConfig` (all optional)

### delete_test_case
Delete a test case and all its runs, files, and configs.
- `testCaseId` (string) — Test case ID

### run_test
Not yet implemented via MCP. Use the REST API `POST /api/run-test` directly.

### get_test_run
Get test run status and result summary.
- `runId` (string) — Test run ID

### get_project_test_summary
Get status breakdown of all test cases in a project.
- `projectId` (string) — Project ID

## Step Writing Guide (Midscene Best Practices)

SkyTest executes AI action steps using Midscene.js, which is vision-driven — it operates
from screenshots, not DOM/selectors.

### Action Steps
- Use natural language: `"Click the blue Submit button in the contact form"`
- NOT selectors: `"Click #submit-btn"`
- Be specific about visible UI: `"the red Buy Now button"` not `"the button"`
- Batch related operations in one step: `"Fill in the email field with '{{EMAIL}}' and the password field with '{{PASSWORD}}', then click the Log In button"`
- One logical interaction per step (but group sub-actions within a step)
- Use `{{VARIABLE_NAME}}` syntax for config variable references
- Quoted strings in steps (e.g. `"Submit"`) are pre-verified on screen before the action executes

### Verification Steps
- Prefix with: `Verify`, `Assert`, `Check`, `Confirm`, `Ensure`, or `Validate`
- **Static UI elements** (menu tabs, page titles, column headers, field labels, button text) → assert exact text:
  `Verify the page title is 'Account Settings'`
- **Dynamic/temporary data** (user content, timestamps, counts, search results) → use generic descriptions:
  `Verify a success notification is displayed`
- Verification steps use Midscene's `aiAssert()` — they fail the test if the condition isn't met

### Multi-line Steps
- Multiple instructions separated by newlines are treated as a single `aiAct()` call
- Use for complex interactions: `"Click the dropdown\nSelect 'Japan'\nClick Apply"`

### Realistic Test Data
- Always use realistic, domain-appropriate data (not `"test123"` or placeholders)
- Understand the product's business domain to generate meaningful test data
- For error tests: use realistic invalid inputs that real users might enter
- Use `RANDOM_STRING` configs for data that must be unique across runs

## Config Variable Patterns

| Type | Usage |
|------|-------|
| `URL` | Base URL for a target (e.g. `https://example.com`) |
| `VARIABLE` | Any string value, optionally masked (passwords, tokens) |
| `RANDOM_STRING` | Auto-generated at runtime (`TIMESTAMP_UNIX`, `TIMESTAMP_DATETIME`, `UUID`) |
| `APP_ID` | Android app package name |

- Names must be `UPPER_SNAKE_CASE`
- Reference in steps: `{{NAME}}` for variables, `{{file:filename}}` for files
- Use `masked: true` for passwords and secrets — leave value empty, set in UI

## Target Config Structure

### Browser
```json
{
  "browser_a": {
    "type": "browser",
    "url": "https://example.com",
    "width": 1920,
    "height": 1080
  }
}
```

### Android
```json
{
  "android_a": {
    "type": "android",
    "deviceSelector": {},
    "appId": "com.example.app",
    "clearAppState": true,
    "allowAllPermissions": true
  }
}
```

## Workflow

1. Study and confirm end-to-end user flows step-by-step (entry URL/App ID -> login -> key flow steps)
2. Design professional QA functional test cases from confirmed flows
3. Present one test case only and ask user to confirm/clarify/skip
4. If confirmed, create exactly that one case as DRAFT via `create_test_cases` (single-item array)
5. Repeat step 3-4 for the next test case (never batch review/create)
6. Report created, skipped, and pending-clarification cases

## Complete Test Case Example

```json
{
  "name": "Login - Happy Path",
  "displayId": "LOGIN-001",
  "browserConfig": {
    "browser_a": {
      "type": "browser",
      "url": "https://myapp.com/login",
      "width": 1920,
      "height": 1080
    }
  },
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
  "configs": [
    { "name": "LOGIN_EMAIL", "type": "VARIABLE", "value": "john.smith@company.com" },
    { "name": "LOGIN_PASSWORD", "type": "VARIABLE", "value": "", "masked": true }
  ]
}
```

## Multi-Target Example (Form + Confirmation Email)

```json
{
  "name": "Registration - Email Confirmation Flow",
  "displayId": "REG-001",
  "browserConfig": {
    "browser_a": {
      "type": "browser",
      "url": "https://myapp.com/register",
      "width": 1920,
      "height": 1080
    }
  },
  "steps": [
    {
      "id": "step_1",
      "target": "browser_a",
      "action": "Fill in the full name field with 'Sarah Johnson', email with '{{REG_EMAIL}}', and password with '{{REG_PASSWORD}}'",
      "type": "ai-action"
    },
    {
      "id": "step_2",
      "target": "browser_a",
      "action": "Click the 'Create Account' button",
      "type": "ai-action"
    },
    {
      "id": "step_3",
      "target": "browser_a",
      "action": "Verify a confirmation message is displayed indicating an email was sent",
      "type": "ai-action"
    }
  ],
  "configs": [
    { "name": "REG_EMAIL", "type": "VARIABLE", "value": "sarah.johnson+{{UNIQUE_ID}}@testmail.com" },
    { "name": "REG_PASSWORD", "type": "VARIABLE", "value": "", "masked": true },
    { "name": "UNIQUE_ID", "type": "RANDOM_STRING", "value": "TIMESTAMP_UNIX" }
  ]
}
```

# Product Strategy: Web AutoTest Agent

## Executive Summary
To transition "Web AutoTest Agent" from a prototype to a profitable SaaS product, we need to move beyond simple "run and view" functionality to a platform that offers **reliability**, **collaboration**, and **insight**.

## Key Value Propositions
1.  **"Set and Forget" Reliability**: Users want to define tests once and have them run automatically (scheduled/CI).
2.  **Actionable Insights**: When tests fail, users need to know *why* immediately (screenshots, logs, AI analysis).
3.  **Team Collaboration**: Testing is rarely a solo activity; teams need shared workspaces.

## Proposed Feature Roadmap

### Phase 1: Foundation (The "Must-Haves")
*   **User Authentication**: Secure login via **Authgear** to manage access and data.
*   **Persistent Storage**: A database (PostgreSQL) to save test definitions, execution history, and user preferences.
*   **Asynchronous Execution**: Decouple test running from the HTTP request using a job queue (Redis/BullMQ). This prevents timeouts and allows for parallel execution.

### Phase 2: Core Product Value
*   **Test Scheduling**: Allow users to run tests hourly, daily, or weekly.
*   **Dashboard & Analytics**: Visual graphs of test pass/fail rates over time.
*   **Test History**: View past run results, including screenshots and logs for every run.
*   **Email/Slack Notifications**: Alert users when a scheduled test fails.

### Phase 3: Growth & Monetization
*   **Subscription Tiers**:
    *   *Free*: Limited runs/month, manual execution only.
    *   *Pro*: Scheduled runs, email alerts, higher concurrency.
    *   *Team*: Shared workspaces, SSO, priority support.
*   **CI/CD Integration**: API keys and CLI tool to trigger tests from GitHub Actions/GitLab CI.
*   **Multi-Browser Support**: Run tests on Chrome, Firefox, Safari (via cloud providers).

## Monetization Strategy
*   **Freemium Model**: Low barrier to entry to get developers hooked.
*   **Usage-Based Pricing**: Charge based on "test execution minutes" or "number of test runs".

## Technical Architecture Changes
To support these features, the architecture must evolve:
*   **Current**: Next.js (Frontend + API) -> Direct Playwright Call (Synchronous)
*   **Proposed**: Next.js (Frontend) -> API -> **Queue (Redis)** -> **Worker Service** -> Playwright -> **Database**

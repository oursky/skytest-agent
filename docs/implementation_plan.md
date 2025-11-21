# Implementation Plan - Phase 1: Foundation

## Goal
Establish the technical foundation required for user management, data persistence, and reliable test execution.

## User Review Required
> [!IMPORTANT]
> This plan introduces significant architectural changes, including a database and a background worker process.
> *   **Database**: We will use Supabase (PostgreSQL) for ease of setup and scalability.
> *   **Auth**: We will use **Authgear** for authentication as requested.
> *   **Queue**: We will use Redis (Upstash for serverless) + BullMQ for the job queue.

## Proposed Changes

### 1. Database Schema (Supabase/PostgreSQL)
We need to model the following entities:
*   `User`: Managed by Authgear, linked via Subject ID (sub).
*   `TestScenario`: Saved test instructions (e.g., "Login and check cart").
*   `TestRun`: A specific execution of a scenario.
*   `TestResult`: The outcome of a run (logs, screenshots, status).

### 2. Authentication (Authgear)
*   Install `@authgear/web` (or appropriate Next.js SDK).
*   Configure Authgear provider in `src/app/layout.tsx` or a dedicated auth provider component.
*   Implement callback routes for OAuth flow.
*   Protect API routes by validating the Authgear session token/cookie.

### 3. Asynchronous Worker (BullMQ + Redis)
*   **Current**: `POST /api/run-test` executes Playwright immediately. This times out on Vercel/serverless functions (10-60s limit).
*   **New Flow**:
    1.  `POST /api/run-test` creates a `TestRun` record (status: PENDING) and adds a job to the Redis queue. Returns `runId` immediately.
    2.  **Worker**: A separate process (or long-running server) picks up the job.
    3.  Worker executes Midscene/Playwright.
    4.  Worker updates `TestRun` record with results (status: COMPLETED/FAILED).
    5.  Frontend polls `GET /api/test-runs/:id` or uses WebSockets/Server-Sent Events to show progress.

### 4. Frontend Updates
*   **Dashboard**: A new page to list saved scenarios and past runs.
*   **Test Runner**: Update the existing form to handle the async flow (show "Queued" -> "Running" -> "Done").

## Verification Plan

### Automated Tests
*   **Unit Tests**: Test the queue producer/consumer logic (mocking Redis).
*   **Integration Tests**: API tests for creating and retrieving test runs.

### Manual Verification
1.  **Sign Up**: Create a new account via Clerk.
2.  **Create Test**: Submit a new test scenario.
3.  **Verify Async**: Ensure the UI shows "Queued" then updates to "Running" without blocking.
4.  **Check Persistence**: Refresh the page and verify the test result is still visible in the history.

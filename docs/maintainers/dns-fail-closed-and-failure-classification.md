# DNS Fail-Closed and Failure Classification

## Scope
- Remove fail-open DNS behavior for browser network guard.
- Keep strict URL/runtime blocking policy.
- Improve reliability signal by classifying failures (infra network vs assertion/script).

## Runtime Policy
- DNS lookup is always fail-closed.
- DNS lookup uses bounded retries before blocking.
- Runtime guard still blocks private/internal destinations after DNS resolution.

## Browser Run Flow
1. Browser target URL runs preflight validation before navigation.
2. Route-level guard validates every request URL.
3. Guard emits structured summary:
   - `blockedRequestCount`
   - `dnsLookupFailureCount`
   - `blockedByCode`
   - `blockedByReason`
   - `blockedByHostname`

## Failure Metadata
- `runTest` classifies FAIL results into:
  - `errorCode`
  - `errorCategory`
- Metadata is serialized in `TestRun.result`.
- APIs expose metadata by parsing stored result:
  - `GET /api/test-runs/:id`
  - SSE status stream `GET /api/test-runs/:id/events`

## Viewer Behavior
- Result viewer marks infra/network failures using metadata.
- Error panel shows classification code and infra-specific guidance text.

## Regression Checklist
- DNS failures should be labeled `DNS_RESOLUTION_FAILED`.
- Assertion failures should be labeled `PLAYWRIGHT_ASSERTION_FAILED`.
- Per-line Playwright code screenshots/logs remain unchanged.
- Completed runs retain classification in history view and SSE replay.

# Browser Execution Without Hosted Runner

This change removes the hosted browser runner model.

## Behavior

- Browser test runs execute directly in the control plane.
- Browser instances are spawned and closed by `runTest` per run.
- Android test runs continue to use macOS runner claims.

## Implementation

- `POST /api/run-test` now creates browser runs as `PREPARING` and starts local execution immediately.
- Local execution lives in `src/lib/runtime/local-browser-runner.ts`.
- Runtime events and screenshot artifacts are persisted directly to `TestRunEvent` and `TestRunFile`.
- `POST /api/test-runs/[id]/cancel` now aborts active local browser execution.

## Removed Legacy Paths

- Removed `src/runners/browser-runner.ts`.
- Removed `runner:browser`, `runner-browser`, `dev-browser`, and `dev-all` orchestration targets.
- Removed `HOSTED_BROWSER`/`BROWSER` runner protocol variants.
- Removed hosted-browser availability counters from team runner UI and service responses.

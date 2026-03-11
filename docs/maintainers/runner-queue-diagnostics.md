# Runner Queue Diagnostics

This project now includes structured diagnostics to troubleshoot runs stuck in `QUEUED`.

## Claim lifecycle logs

- Endpoint: `POST /api/runners/v1/jobs/claim`
- Success log includes:
  - `runnerId`, `teamId`, `runId`
  - `requestedDeviceId`, `requiredCapability`
  - `leaseExpiresAt`, `elapsedMs`
- Empty-claim log includes:
  - `reasonCode`
  - queue counters (`queuedAndroidRuns`, `queuedCompatibleKindRuns`, `explicitRequestedRuns`, `genericQueuedRuns`)
  - `claimableDeviceIds`

Use these logs to quickly identify whether the issue is:
- no queued work,
- capability/kind mismatch,
- requested device mismatch,
- or lock contention.

## Run diagnostics endpoint

- Endpoint: `GET /api/debug/test-runs/:id/diagnostics`
- Access: authenticated project members only.

Response includes:
- run assignment/lease state,
- team runner snapshots (`status`, `capabilities`, `isFresh`, claimable device IDs),
- published runner devices,
- run claimability analysis (`reasonCode`, `eligibleRunnerIds`, `matchingRequestedDeviceRunnerIds`),
- per-runner no-claim diagnostics from claim service.

This endpoint is intended for operator debugging and support workflows.

## Lifecycle logs

Additional logs were added at key transitions:
- run creation (`POST /api/test-runs/dispatch`)
- local browser execution start (`POST /api/test-runs/dispatch`)
- run completion/failure by runner (`apps/web/src/lib/runners/event-service.ts`)
- run cancellation (`POST /api/test-runs/:id/cancel`)

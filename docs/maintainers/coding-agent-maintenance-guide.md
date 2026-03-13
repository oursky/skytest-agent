# Coding Agent Maintenance Guide

This guide is for developers and coding agents making changes in this repository.

It complements `AGENTS.md` with repository-specific runtime invariants.

## Read These First

- `AGENTS.md` (repo workflow, constraints, style)
- [android-runtime-maintenance.md](./android-runtime-maintenance.md)
- [../operators/android-runtime-deployment-checklist.md](../operators/android-runtime-deployment-checklist.md)
- [../../infra/README.md](../../infra/README.md)

## High-Risk Runtime Areas

### 1. Runner Orchestration (`apps/web/src/lib/runners/*`, `apps/web/src/app/api/runners/v1/*`)

Responsibilities:

- runner auth and token lifecycle
- claim/lease ownership for queued runs
- runner heartbeat/device sync
- ordered event ingestion and terminal run transitions
- retention and lease maintenance (`apps/web/src/workers/runner-maintenance.ts`)

Key invariants:

- claim must be atomic and prevent double-claim
- write-back endpoints must enforce assigned runner + active lease ownership
- stream token scope checks must remain strict per run/resource
- maintenance tasks should stay out of Next.js request lifecycle

### 2. Runner Client (`apps/macos-runner/runner/index.ts`)

Responsibilities:

- register/heartbeat with control plane
- publish device inventory
- claim Android jobs and execute tests
- push events/artifacts/final status

Key invariants:

- protocol version fields must be sent on every runner request
- runner token rotation/expiry behavior must not be bypassed
- runners must not mutate app installation state automatically

### 3. Execution Engine (`apps/web/src/lib/runtime/test-runner.ts`)

Responsibilities:

- shared browser/Android execution logic used by runner clients
- step execution, event generation, and cleanup behavior

Key invariants:

- cleanup must stay idempotent when cancellation races run completion
- Android device handles must be released via `androidDeviceManager.release(...)`
- `clearAppState` and permission behavior must remain stable

## Runtime Relationship

- `apps/cli`: operator control plane from terminal (`pair/start/stop/logs/reset`).
- `apps/macos-runner`: long-running Android execution worker process.
- `apps/web`: web UI + API control plane + MCP server.

The CLI supervises local runner lifecycle; the macOS runner executes jobs.

## Backend / Frontend / MCP Boundaries

| Boundary | Location | Responsibilities |
|---|---|---|
| Frontend | `apps/web/src/app/**`, `apps/web/src/components/**` | App Router pages, UI rendering, client hooks |
| Web backend | `apps/web/src/app/api/**`, `apps/web/src/lib/**`, `apps/web/src/workers/**` | API auth, queueing, scheduling, persistence, maintenance loops |
| MCP backend | `apps/web/src/app/api/mcp/route.ts`, `apps/web/src/lib/mcp/**` | MCP transport, tool contracts, tool execution |
| Operator backend | `apps/cli/**` | Human-operated runtime control commands |
| Runner backend | `apps/macos-runner/**` | Runner register/heartbeat/claim/execute/event/artifact flows |

## Control Plane Constraints

- Browser execution is dispatched per run from API or MCP queueing paths and runs inside control-plane processes.
- Do not re-introduce a dedicated `runner:browser` workload or parallel raw Kubernetes manifests for the same deployment topology.
- Android execution stays runner-owned and must not move into web request handlers.
- Team-facing device visibility must come from runner-published inventory, not host-local inspection.
- Do not re-introduce project-scoped device inventory surfaces; active UI is `Team Settings -> Runners`.
- Do not re-introduce host-local Android inventory assumptions into web APIs.

If you add features that expose Android state/control:

- preserve ownership checks
- keep behavior team/project-scoped through runner ownership
- avoid privileged host-level actions from web routes

## Local Orchestration

The top-level `Makefile` is the source of truth for multi-step local workflows:

- `make bootstrap` installs dependencies, starts local services, and applies the schema
- `make dev` starts the local control plane and the maintenance loop
- `make app` starts only the Next.js control plane
- `make maintenance` starts only the maintenance loop
- `make runner-reset` clears local runner state
- `make verify` runs the repo verification checks

Do not duplicate those workflows in new scripts or stale runbooks.

## Browser Network Guard And Failure Metadata

When changing browser execution behavior, keep these invariants stable:

- DNS lookup is fail-closed before navigation and during guarded requests.
- Private, loopback, and internal destinations remain blocked after DNS resolution.
- `classifyRunFailure` writes `errorCode` and `errorCategory` into `TestRun.result`.
- `GET /api/test-runs/:id`, the SSE event stream, and the result viewer all depend on that stored failure metadata.

## Documentation Update Checklist for Code Changes

When changing runner runtime behavior, update docs in the same PR/commit series:

- Operator-facing impact:
  - [../operators/local-development.md](../operators/local-development.md)
  - [../operators/macos-android-runner-guide.md](../operators/macos-android-runner-guide.md)
  - [../operators/android-runtime-deployment-checklist.md](../operators/android-runtime-deployment-checklist.md)
  - [../../infra/helm/README.md](../../infra/helm/README.md)
- Maintainer-facing impact:
  - [android-runtime-maintenance.md](./android-runtime-maintenance.md)
- Import/export behavior:
  - [test-case-excel-format.md](./test-case-excel-format.md)

## Common Footguns

- Changing Excel import parser compatibility paths without updating [test-case-excel-format.md](./test-case-excel-format.md)
- Breaking runner protocol request/response shapes without updating `packages/runner-protocol`
- Bypassing lease ownership checks on runner write-back endpoints
- Re-introducing dedicated browser worker deployments
- Re-introducing browser-side `process.env` dependencies for deployment-specific config
- Changing operator-visible runner/device behavior without updating setup/runbook docs

## Browser Failure Triage (Blank Page / Selector Not Found)

Use this sequence before changing test steps:

1. Inspect run events for runtime guard blocks:
   - `Blocked request to <host>: <reason>`
   - `Network guard summary: {...}`
2. From the same runtime host, verify DNS and HTTP:
   - `node -e "require('node:dns').promises.lookup('<host>', { all: true, verbatim: true }).then(console.log).catch(console.error)"`
   - `curl -I https://<host>/<path>`
3. If requests are blocked by the runtime guard, fix network or policy first; do not tweak selectors yet.
4. Only debug Playwright selectors/assertions after network guard errors are resolved.

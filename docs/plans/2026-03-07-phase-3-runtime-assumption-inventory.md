# Phase 3 Runtime Assumption Inventory

**Date:** 2026-03-07
**Goal:** identify legacy runtime assumptions that must be replaced for Phase 3

## Replace

1. `src/lib/runtime/queue.ts`
- Assumption: API process is the durable execution scheduler and state owner.
- Replacement: DB-backed runner claim/lease services with separate maintenance worker.

2. `src/app/api/run-test/route.ts`
- Assumption: run submission can trigger API-local execution path.
- Replacement: durable run creation with runner claim path only.

3. `src/app/api/test-runs/[id]/events/route.ts`
- Assumption: SSE event source can rely on queue-owned in-memory event data.
- Replacement: persisted `TestRunEvent` rows as source of truth, with low-latency fanout optimization.

4. `src/lib/mcp/server.ts` run cancellation path
- Assumption: cancellation can depend on queue singleton ownership.
- Replacement: durable run state services and runner-facing cancel semantics.

5. `src/app/api/devices/route-impl.ts`
- Assumption: API host Android runtime is an authoritative device source.
- Replacement: runner-published device inventory only.

## Migrate

1. `src/app/api/test-runs/[id]/cancel/route.ts`
- Keep route shape where possible.
- Migrate implementation from queue cancellation to durable run state plus runner acknowledgement.

2. `src/lib/runtime/test-runner.ts`
- Preserve core execution behavior.
- Migrate ownership into hosted browser runner and macOS runner paths via shared execution package.

3. `src/lib/runtime/android-reservations.ts`
- Preserve reservation intent where useful.
- Migrate backing state to durable scheduling/lease services.

## Delete

1. queue-only helpers after callers reach zero:
- `src/lib/runtime/project-events.ts`
- queue event fanout code in `src/lib/runtime/queue.ts`

2. API-local Android inventory paths after runner inventory is live:
- `src/app/api/devices/route-impl.ts`
- host-local Android capability checks in submission/selection flows

3. MCP legacy queue and local inventory fallbacks after durable services are in place:
- queue imports in `src/lib/mcp/server.ts`
- local inventory resolution in `src/lib/mcp/android-selector.ts`

## Completion Rule

No Phase 3 branch is complete until `rg` confirms queue-owned execution and API-local inventory assumptions are removed from runtime ownership paths.

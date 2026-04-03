# SSE Load Gate Plan

Date: 2026-04-03  
Phase: 0 draft  
Target endpoint: `/api/test-runs/[id]/events`

## 1. Objective

Define a repeatable load gate for SSE run-event streaming to detect regressions in:
- connection stability
- event delivery latency
- throughput/backpressure
- server error rate

This gate is required for slices that touch SSE transport, run event ingestion, run status publishing, or event-query data access.

## 2. Scope

In scope:
- open N concurrent SSE clients for one or more run IDs
- continuously append runner events via existing runner endpoints/services
- measure delivery lag from event creation to client receive time
- measure reconnect behavior and stream continuity

Out of scope (Phase 0):
- browser rendering performance
- cross-region network simulation
- exhaustive failure injection beyond basic disconnect/reconnect

## 3. Proposed Script Scope

Proposed new script:
- `apps/web/scripts/load-gate/gate-sse-events.ts`

Responsibilities:
1. Seed a deterministic run dataset (or reuse seeded run IDs from env).
2. Spawn configurable SSE client pool.
3. Emit events at controlled rates.
4. Track delivered event counts, ordering, and delay percentiles.
5. Emit JSON report to file for CI/PR artifact collection.
6. Exit non-zero when thresholds fail.

Required env inputs:
- `LOAD_GATE_SSE_BASE_URL` (default `http://127.0.0.1:3000`)
- `LOAD_GATE_SSE_PROJECT_ID` or seed mode toggle
- `LOAD_GATE_SSE_RUN_COUNT` (default 20)
- `LOAD_GATE_SSE_CLIENTS_PER_RUN` (default 2)
- `LOAD_GATE_SSE_EVENT_BURST` (events per second target)
- `LOAD_GATE_SSE_DURATION_MS` (default 120000)
- `LOAD_GATE_SSE_REPORT_FILE` (default `/tmp/skytest-sse-gate.json`)

Output report fields:
- total connections attempted/succeeded
- reconnect count
- total events emitted
- total events received
- event loss ratio
- event ordering violations
- latency p50/p95/p99
- SSE stream error count
- HTTP status distribution

## 4. Baseline Workloads

Define three baseline profiles:

1. `smoke`
- 5 runs
- 1 client per run
- low event rate
- goal: correctness and stability

2. `standard`
- 20 runs
- 2 clients per run
- moderate event burst
- goal: default PR gate for SSE-touching changes

3. `stress`
- 50 runs
- 3 clients per run
- high event burst
- goal: periodic benchmark and release gate

## 5. Pass/Fail Criteria (Initial)

For `standard` profile:
1. stream setup success rate >= 99%
2. event loss ratio <= 0.1%
3. ordering violations = 0
4. p95 delivery lag <= 1500 ms
5. p99 delivery lag <= 3000 ms
6. server-side 5xx ratio <= 0.1%

Any threshold failure is gate failure.

## 6. Data Collection Notes

- Use monotonic timestamps when possible for local latency calculations.
- Capture both producer timestamp and client receive timestamp.
- Persist raw samples for percentile recalculation when debugging.

## 7. CI Integration Plan

1. Add `npm run load-gate:sse` command once script is implemented.
2. Run `smoke` profile on all PRs touching SSE/event paths.
3. Run `standard` profile on protected branch merge queue.
4. Run `stress` profile nightly.

## 8. Dependencies and Preconditions

- Local or CI environment with running web app and database.
- Deterministic seeded runs with event stream activity.
- Stable auth token mode for SSE clients (`verifyAuth` or stream token path).

## 9. Follow-up Implementation Tasks

1. Implement `gate-sse-events.ts` script under `apps/web/scripts/load-gate/`.
2. Add npm script entries for smoke/standard profiles.
3. Add report parser summary in CI logs.
4. Add baseline snapshots for pre/post comparisons in SSE-impacting PRs.

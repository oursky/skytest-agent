# Performance Observability Reference

This document describes the current performance telemetry emitted by the app.

Use it together with the deployment repo runbook:

1. `skytest-agent-deployment/docs/performance/post-launch-metrics-runbook.md`

## 1) Route performance logs (server)

Helper:

1. [apps/web/src/lib/core/route-perf.ts](/Users/joyzng/Documents/projects-test/skytest/skytest-agent/apps/web/src/lib/core/route-perf.ts)

Log message:

1. `Route performance`

Structured fields:

1. `route`
2. `method`
3. `statusCode`
4. `requestId`
5. `authMs`
6. `dbMs`
7. `handlerMs`
8. `totalMs`
9. `responseBytes`

## 2) Web vitals + loading metrics (client -> server)

Client reporter:

1. [apps/web/src/components/layout/WebVitalsReporter.tsx](/Users/joyzng/Documents/projects-test/skytest/skytest-agent/apps/web/src/components/layout/WebVitalsReporter.tsx)
2. [apps/web/src/lib/telemetry/client-metrics.ts](/Users/joyzng/Documents/projects-test/skytest/skytest-agent/apps/web/src/lib/telemetry/client-metrics.ts)

Ingestion endpoint:

1. [apps/web/src/app/api/telemetry/web-vitals/route.ts](/Users/joyzng/Documents/projects-test/skytest/skytest-agent/apps/web/src/app/api/telemetry/web-vitals/route.ts)

Allowed metric names:

1. `TTFB`
2. `LCP`
3. `INP`
4. `CLS`
5. `FCP`
6. `LOAD_DATA_READY`
7. `LOAD_REFRESH_VISIBLE`
8. `LOAD_SLOW_WARNING`

Log message:

1. `Web vitals metric`

Payload fields:

1. `id`
2. `name`
3. `value`
4. `rating` (`good` | `needs-improvement` | `poor`)
5. `navigationType`
6. `path`
7. `ts`

## 3) MCP tool telemetry

Source:

1. [apps/web/src/lib/mcp/server.ts](/Users/joyzng/Documents/projects-test/skytest/skytest-agent/apps/web/src/lib/mcp/server.ts)

Log messages:

1. `MCP tool handled`
2. `MCP tool failed`

Fields:

1. `toolName`
2. `elapsedMs`
3. `responseBytes` (handled)
4. `isError` (handled)
5. `error` (failed)

## 4) Queue/claim diagnostics

Reference:

1. [runner-queue-diagnostics.md](/Users/joyzng/Documents/projects-test/skytest/skytest-agent/docs/maintainers/runner-queue-diagnostics.md)

Primary endpoint:

1. `POST /api/runners/v1/jobs/claim`

## 5) Load-check scripts

Scripts:

1. [gate-browser-runs.ts](/Users/joyzng/Documents/projects-test/skytest/skytest-agent/apps/web/scripts/load-gate/gate-browser-runs.ts)
2. [seed-runner-claim.ts](/Users/joyzng/Documents/projects-test/skytest/skytest-agent/apps/web/scripts/load-gate/seed-runner-claim.ts)
3. [runner-claim.k6.js](/Users/joyzng/Documents/projects-test/skytest/skytest-agent/apps/web/scripts/load-gate/runner-claim.k6.js)

## 6) Quick verification checklist (after deploy)

1. `POST /api/telemetry/web-vitals` returns `204` for a valid payload.
2. `Route performance` logs appear on scoped API routes.
3. `Web vitals metric` logs include real traffic paths.
4. `MCP tool handled` logs appear for high-volume tools.

# Single-container deployment

SkyTest's control plane is three long-running loops. They can run as three separate containers, or —
for small deployments where a dedicated container per loop is not worth the cost — as one container
supervised by `apps/web/scripts/runtime/run-all-in-one.sh`.

| Loop | Command | Required env |
|------|---------|--------------|
| Next.js web server | `npm run start -- --hostname 0.0.0.0 --port 3000` | `SKYTEST_BROWSER_WORKER=false` |
| Browser runner worker | `npm run browser:worker` | `SKYTEST_BROWSER_WORKER=true` |
| Runner maintenance worker | `npm run runner:maintenance` | `RUNNER_MAINTENANCE_ONCE=false`, `SKYTEST_SCHEDULER=true` |

## Running all three in one container

```bash
docker run --rm \
  -p 3000:3000 \
  --env-file .env.production \
  <image> /bin/bash /app/apps/web/scripts/runtime/run-all-in-one.sh
```

Optional overrides: `SKYTEST_BIND_HOST` (default `0.0.0.0`), `SKYTEST_BIND_PORT` (default `3000`),
`SKYTEST_SHUTDOWN_GRACE_SECONDS` (default `240`).

## Invariants the entrypoint enforces

**Exactly one process may set `SKYTEST_BROWSER_WORKER=true`.** Browser runs execute in-process and
their capacity map (`RUNNER_MAX_LOCAL_BROWSER_RUNS`) lives in process memory. A second process with
the flag on runs a second dispatcher, and the two over-admit concurrent Chromium instances against a
shared memory budget. The script scopes the flag to the browser worker child only — set it to `false`
(or leave it unset) in the container environment.

The same reasoning caps the deployment at **one replica**. Scale browser capacity with
`RUNNER_MAX_LOCAL_BROWSER_RUNS` plus container memory, or by attaching self-hosted
macOS/Android runners — not by adding replicas of this container.

**Signals are forwarded.** `SIGTERM`/`SIGINT` reach every child, so each worker's graceful shutdown
runs and in-flight test runs drain instead of being killed mid-step. Give the orchestrator a stop
grace period at least as long as `SKYTEST_SHUTDOWN_GRACE_SECONDS`; the default 5–30 s used by most
platforms will cut runs short.

**Any child exiting takes the container down.** The supervisor stops the siblings and exits non-zero
so the orchestrator restarts everything. Without this, a dead browser worker would leave the
container serving HTTP and passing health checks while silently never dispatching a run.

## Sizing

The web server needs roughly 400–600 MB before any test runs. Each concurrent headless Chromium adds
roughly 300–500 MB. A 2 GB container comfortably fits the web server plus
`RUNNER_MAX_LOCAL_BROWSER_RUNS=2`; add swap or memory before raising that number. Two vCPUs keep
Chromium from starving request handling.

## Health

Point readiness probes at `/api/health/ready` with a grace period of at least 60 s — all three loops
boot together and the web server answers last. `/api/health/dependencies` reports database and object
storage reachability.

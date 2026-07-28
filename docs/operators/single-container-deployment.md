# Runtime roles and container layout

SkyTest's control plane is three long-running loops. `apps/web/scripts/runtime/run-runtime.sh`
supervises any combination of them in one container, so the same image serves both a single-container
deployment and a split one.

```bash
run-runtime.sh web maintenance worker   # everything in one container
run-runtime.sh web maintenance          # request-serving container
run-runtime.sh worker                   # browser-execution container
```

| Role | Process | Listens | Notes |
|------|---------|---------|-------|
| `web` | Next.js server | port 3000 | The only role that binds a port |
| `maintenance` | lease reaping, retention, queue sanitation, scheduler tick | — | Sets `SKYTEST_SCHEDULER=true` |
| `worker` | browser runner | — | The only role that sets `SKYTEST_BROWSER_WORKER=true` |

Overrides: `SKYTEST_BIND_HOST` (default `0.0.0.0`), `SKYTEST_BIND_PORT` (`3000`),
`SKYTEST_SHUTDOWN_GRACE_SECONDS` (`240`), and per-role heap caps `SKYTEST_WEB_HEAP_MB` (`256`),
`SKYTEST_MAINTENANCE_HEAP_MB` (`128`), `SKYTEST_WORKER_HEAP_MB` (`320`).

Set `SKYTEST_SCHEDULER=false` to pause automated schedules while keeping lease reaping and retention;
the `maintenance` role defaults it to `true` but honours an explicit value. `SKYTEST_BROWSER_WORKER`
is deliberately not overridable — the entrypoint hard-sets it per role.

## Invariants the supervisor enforces

**At most one `worker` across the whole deployment.** Browser runs execute in-process and their
capacity map (`RUNNER_MAX_LOCAL_BROWSER_RUNS`) lives in process memory, so a second dispatcher
over-admits concurrent Chromium against a shared memory budget. The script rejects two `worker`
arguments; keeping it to one *container* is the operator's job. Scale browser capacity by raising
`RUNNER_MAX_LOCAL_BROWSER_RUNS` with matching memory, not by adding worker containers.

**Signals are forwarded.** `SIGTERM`/`SIGINT` reach every child, so each worker's graceful shutdown
runs and in-flight runs drain instead of dying mid-step. Give the orchestrator a stop grace period at
least as long as `SKYTEST_SHUTDOWN_GRACE_SECONDS`; the 5–30 s default on most platforms cuts runs short.

**Any child exiting takes the container down** (non-zero exit). Without this, a dead browser worker
would leave the container serving HTTP and passing health checks while silently never dispatching.

## Why Node is invoked directly

The script calls `node node_modules/.bin/{next,tsx}` rather than `npm run`. Each `npm run` is a whole
extra Node process — measured at ~90–120 MiB each, ~300 MiB across three roles — that does nothing but
hold a child.

Heaps are capped explicitly because Node sizes `--max-old-space-size` from **host** RAM, not the
cgroup limit, and will grow well past a container's budget before GC gets serious. Measured on the
published image at 2 GB / 2 CPU, the two changes together cut anonymous memory from 1064 → 847 MiB.

## Sizing

Measured on the published amd64 image with a real database (page cache excluded):

| Container | Idle | With one Chromium |
|---|---|---|
| `web` + `maintenance` | ~520 MiB | n/a |
| `worker` | ~400 MiB | ~690 MiB, peaks ~750 MiB |
| all three roles | ~850 MiB | add ~300 MiB per concurrent browser |

Budget ~300–500 MiB per concurrent Chromium on top of the idle figure, and give the container swap if
the platform allows it — Chromium's launch spike is larger than its steady state. Two vCPUs keep
Chromium from starving request handling.

## Health

Point readiness probes at `/api/health/ready` with a grace period of at least 60 s — the roles boot
together and the web server answers last. `/api/health/dependencies` reports database and object
storage reachability.

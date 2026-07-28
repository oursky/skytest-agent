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

## Platform-injected credentials

`scripts/runtime/platform-env.sh` is sourced by both entrypoints. Where the orchestrator provisions
Postgres and object storage itself and injects `SKYROCKET_*` variables, it maps them onto SkyTest's
env contract so no credential has to be copied into a secret store by hand:

| Injected | Becomes |
|---|---|
| `SKYROCKET_POSTGRES_URL` | `DATABASE_URL` + `connection_limit` / `pool_timeout` |
| `SKYROCKET_S3_ENDPOINT_URL`, `…_REGION`, `…_PRIVATE_BUCKET_NAME`, `…_ACCESS_KEY`, `…_SECRET_KEY` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true` |

Explicit values always win — setting `DATABASE_URL` or `S3_ENDPOINT` yourself disables the mapping for
that resource. With no `SKYROCKET_*` variables present the script is a no-op, so it changes nothing
on platforms where you supply credentials directly.

`SKYTEST_DB_CONNECTION_LIMIT` (default `2`) caps Prisma's pool **per process**. Every role opens its
own pool, and a rolling update runs old and new containers concurrently, so peak connections are
roughly `roles × limit × 2`. Size it against the database's connection budget.

## Applying migrations

`scripts/runtime/run-migrations.sh` runs `prisma migrate deploy` and exits. Run it as a pre-deploy
job so a failed migration stops the rollout and the app never starts against a schema it was not
built for. It resolves credentials through the same `platform-env.sh` mapping, and exits `78` if no
database URL or Prisma CLI is available.

## Database backups

The `maintenance` role can take a periodic `pg_dump` and upload it to object storage. It is **off by
default** — enable it only where the platform does not back the database up for you.

| Variable | Default | Purpose |
|---|---|---|
| `SKYTEST_DB_BACKUP_ENABLED` | `false` | Master switch |
| `SKYTEST_DB_BACKUP_INTERVAL_HOURS` | `24` | Minimum gap between dumps |
| `SKYTEST_DB_BACKUP_RETENTION_DAYS` | `30` | Age at which dumps are deleted |
| `SKYTEST_DB_BACKUP_MAX_BYTES` | `512 MiB` | Refuses to upload beyond this |

Dumps land under `backups/` in the same bucket, alongside a `backups/manifest.json` that records what
exists and when. The manifest is what makes the schedule survive restarts — there is no extra table
and no separate cron container. Credentials reach `pg_dump` through `PG*` environment variables, so
the password never appears in the process list.

Restore with `pg_restore` against an empty database:

```bash
aws s3 cp s3://<bucket>/backups/skytest-<timestamp>.dump . --endpoint-url "$S3_ENDPOINT"
pg_restore --no-owner --no-acl --dbname "$TARGET_DATABASE_URL" skytest-<timestamp>.dump
```

Two constraints worth knowing. The dump is buffered in memory for upload, which is why
`SKYTEST_DB_BACKUP_MAX_BYTES` exists — past that the job refuses rather than risking an OOM, and the
fix is a streaming upload rather than a bigger limit. And `pg_dump` must be at least the server's
major version; the image ships client 17.

**Drill the restore before you rely on it.** An untested backup is a guess.

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

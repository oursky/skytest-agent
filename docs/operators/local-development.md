# Local Development

This guide covers repo-local development.

The local stack mirrors the production data plane:

- PostgreSQL for application state
- MinIO (S3-compatible) for files and artifacts
- local Authgear for portal login (`http://localhost:3301` by default)
- a local Next.js control plane process

## Prerequisites

- Docker Engine with Compose
- Node.js matching the repo toolchain
- Playwright Chromium (auto-installed by `make bootstrap` and `make dev` when missing)

## Quick Start

Start from the checked-in environment template:

```bash
cp .env.example .env.local
make bootstrap
make dev
```

SkyTest CLI also exposes local lifecycle wrappers for these workflows:

```bash
npm run skytest -- local setup
npm run skytest -- local up
npm run skytest -- local up -d
npm run skytest -- local status
npm run skytest -- local down
```

- `skytest local setup` runs bootstrap (`make bootstrap`) and then `skytest init`.
- `skytest local up` runs `make dev` in foreground.
- `skytest local up -d` starts `make dev` in background and waits for full readiness (health endpoint + app + maintenance worker + browser worker), then returns.
- `skytest local status` checks compose services and key local processes.
- `skytest local down` runs runner reset and then stops compose services.
- `skytest local update` is the post-`git pull` refresh flow (install, services up, DB setup, Playwright ensure, seed defaults, init).

`make dev` does all of the following:

- starts Postgres and MinIO from `infra/docker/docker-compose.local.yml`
- starts local Authgear and Redis from `infra/docker/docker-compose.local.yml`
- generates the Prisma client and applies the schema
- installs Playwright Chromium when it is not already available locally
- starts the Next.js control plane on `http://127.0.0.1:3000`
- starts the runner maintenance loop

Browser test runs execute inside the control-plane process. Android test runs execute on external macOS runners paired to the same control plane.

## Useful Targets

Use the `Makefile` as the source of truth for multi-step local workflows:

```bash
make help
make bootstrap
make dev
make app
make maintenance
make services-up
make services-down
make services-logs
make runner-reset
make verify
npm run --workspace @skytest/web smoke:storage
```

Use `make app` and `make maintenance` in separate terminals when you want to run the control plane and the maintenance loop independently.

## Environment

`.env.example` is split into two tiers:

- active required keys for local startup
- commented optional overrides (defaults are already in code)

Copy `.env.example` to `.env.local`, then keep `.env.local` minimal: required keys plus only the overrides you intentionally changed.

Local defaults point to:

- Postgres on `127.0.0.1:5432`
- MinIO S3 endpoint on `127.0.0.1:9000`
- Authgear on `http://localhost:3301`

Optional Slack notification local setup:

- Enable `SKYTEST_SLACK_NOTIFICATIONS=true`
- Set `APP_BASE_URL=http://127.0.0.1:3000`
- Follow [slack-app-setup.md](./slack-app-setup.md) to install a workspace app and connect the token in Team Settings -> Integration

## Per-Checkout SkyTest Runtime Config

SkyTest local runtime settings are checkout-scoped:

- runtime config file: `.skytest/skytest.yaml` (tracked in git)
- local identity lockfile: `.skytest/instance.lock.yaml` (ignored by git)

Initialize the local runtime scaffold with:

```bash
npm run skytest -- init
```

`skytest init` is idempotent. It creates missing files and keeps existing files unchanged.

`skytest.yaml` is for runtime and test catalog settings only. Auth/login setup is managed by CLI auth flows, not in `skytest.yaml`.

## Local Default Seed Ownership

`make bootstrap` now also seeds a deterministic local default owner account and attaches the default Case Study project to it.

Default values (override in `.env.local` if needed):

- `SKYTEST_LOCAL_SEED_EMAIL=local-dev@skytest.local`
- `SKYTEST_LOCAL_SEED_PASSWORD=Abcd1234`
- `SKYTEST_LOCAL_SEED_TEAM_NAME=Local Team`
- `SKYTEST_LOCAL_SEED_PROJECT_NAME=Case Study App`

The bootstrap seed ensures:

- an Authgear login exists for the default local user
- a matching SkyTest `User` record exists
- a default owner team exists and membership is `OWNER`
- a default `Case Study App` project exists under that team and is owned (`createdByUserId`) by the default user

You can run the seed independently with:

```bash
make seed-local-defaults
```

Concurrency defaults:

- `RUNNER_MAX_CONCURRENT_RUNS=4` controls the global active-run ceiling.
- Project setting `Max concurrent runs` is applied per project (default `1`).
- Project setting upper bound is derived as `floor(RUNNER_MAX_CONCURRENT_RUNS / 2)`.
- `RUNNER_MAX_LOCAL_BROWSER_RUNS` is optional. When unset, it inherits `RUNNER_MAX_CONCURRENT_RUNS`.
- `RUNNER_MAX_CONCURRENT_RUNS_PER_ANDROID_RUNNER=2` limits active Android runs per macOS runner.

## Android Runners

Android execution requires a separate macOS runner process. Use these guides instead of duplicating runner setup here:

- [macOS Android runner guide](./macos-android-runner-guide.md)
- [macOS runner environment](./macos-runner-environment.md)

## Reset

Reset local runner state:

```bash
make runner-reset
```

Reset local services and data:

```bash
make services-down
docker compose -f infra/docker/docker-compose.local.yml down -v
make bootstrap
```

## Troubleshooting

### Port already in use

If `5432`, `9000`, or `9001` is already in use, stop the conflicting process or change host port mapping in `infra/docker/docker-compose.local.yml`.

### Bucket not created

Re-run the bucket bootstrap container:

```bash
docker compose -f infra/docker/docker-compose.local.yml run --rm create-minio-bucket
```

### Browser runs fail before navigation

Confirm Chromium is installed on the local machine:

```bash
make playwright-install
```

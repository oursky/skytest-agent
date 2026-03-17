# Local Development

This guide covers repo-local development.

The local stack mirrors the production data plane:

- PostgreSQL for application state
- MinIO (S3-compatible) for files and artifacts
- a local Next.js control plane process

## Prerequisites

- Docker Engine with Compose
- Node.js matching the repo toolchain
- Playwright Chromium installed on the machine that will execute browser runs

Install Chromium once per machine:

```bash
make playwright-install
```

## Quick Start

Start from the checked-in environment template:

```bash
cp .env.example .env.local
make bootstrap
make dev
```

`make dev` does all of the following:

- starts Postgres and MinIO from `infra/docker/docker-compose.local.yml`
- generates the Prisma client and applies the schema
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

`.env.example` contains the supported local defaults. Copy it to `.env.local` and adjust values for your machine or auth tenant.

Local defaults point to:

- Postgres on `127.0.0.1:5432`
- MinIO S3 endpoint on `127.0.0.1:9000`

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

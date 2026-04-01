# Infrastructure

This directory contains local developer infrastructure artifacts that stay in sync with runtime behavior.

## Source Of Truth

- `infra/docker/docker-compose.local.yml` is the local development services stack.
- Shared deployment orchestration is managed in a private infrastructure repository.

## Local Runtime Topology

The local stack runs:

- PostgreSQL for application state
- MinIO for S3-compatible object storage

Application processes (`web`, `browser`, `maintenance`) run from the repo workspace and connect to the local services above.

Browser run concurrency in local topology is controlled by environment config:

- `RUNNER_MAX_CONCURRENT_RUNS` (global active-run ceiling)
- `RUNNER_MAX_LOCAL_BROWSER_RUNS` (local browser worker ceiling; defaults to `RUNNER_MAX_CONCURRENT_RUNS` when unset)
- `RUNNER_MAX_CONCURRENT_RUNS_PER_ANDROID_RUNNER` (per-runner Android active-run ceiling; default `2`)

Project-level concurrency UI limits are derived from global capacity:

- max project setting = `floor(RUNNER_MAX_CONCURRENT_RUNS / 2)`

## External Dependencies (Shared Deployments)

Shared deployments require:

- Managed PostgreSQL (for example, Fly Postgres or company-managed Postgres)
- Fly Tigris (S3-compatible object storage)
- Authgear
- one or more external macOS runners for Android test execution

## Next Steps

- [Local development services](../docs/operators/local-development.md)
- [Android runtime deployment checklist](../docs/operators/android-runtime-deployment-checklist.md)

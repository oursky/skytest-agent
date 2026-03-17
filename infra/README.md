# Infrastructure

This directory contains local developer infrastructure artifacts that stay in sync with runtime behavior.

## Source Of Truth

- `infra/docker/docker-compose.local.yml` is the local development services stack.
- Shared deployment orchestration is managed in `skytest-agent-deployment`.

## Local Runtime Topology

The local stack runs:

- PostgreSQL for application state
- MinIO for S3-compatible object storage

Application processes (`web`, `browser`, `maintenance`) run from the repo workspace and connect to the local services above.

## External Dependencies (Shared Deployments)

Shared deployments require:

- Supabase Postgres
- Fly Tigris (S3-compatible object storage)
- Authgear
- one or more external macOS runners for Android test execution

## Next Steps

- [Local development services](../docs/operators/local-development.md)
- [Android runtime deployment checklist](../docs/operators/android-runtime-deployment-checklist.md)

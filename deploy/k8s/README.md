# Kubernetes Deployment Blueprint (Reference)

Prefer `deploy/helm` for active deployment packaging. This folder remains as a plain-manifest reference.

This folder contains a production-oriented baseline for deploying SkyTest Agent with separated control-plane and browser-execution workers.

## Components

- `control-plane-deployment.yaml`
  - Next.js web/API service (`npm run start`)
  - Horizontally scalable
- `browser-runner-deployment.yaml`
  - Internal browser run worker (`npm run runner:browser`)
  - Claims `BROWSER` queued runs using DB lease ownership
- `runner-maintenance-cronjob.yaml`
  - Periodic maintenance worker (`RUNNER_MAINTENANCE_ONCE=true npm run runner:maintenance`)
  - Handles lease reaping + event/artifact retention
- `control-plane-service.yaml`
  - Cluster service for control plane
- `hpa.yaml`
  - Optional autoscaling policy for control plane

## External Dependencies

- PostgreSQL (managed, HA, backups enabled)
- S3-compatible object storage (managed)
- Authgear tenant
- macOS `MACOS_AGENT` runners for Android execution (outside k8s)

## Required Secrets / Env

Define a Secret (example name: `skytest-agent-secrets`) with at least:

- `DATABASE_URL`
- `ENCRYPTION_SECRET`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`
- `NEXT_PUBLIC_AUTHGEAR_CLIENT_ID`
- `NEXT_PUBLIC_AUTHGEAR_ENDPOINT`
- `NEXT_PUBLIC_AUTHGEAR_REDIRECT_URI`

Optional:

- `STREAM_POLL_INTERVAL_MS` (default `1500`)
- `RUNNER_LEASE_DURATION_SECONDS`
- `RUNNER_LEASE_REAPER_INTERVAL_MS`
- `RUNNER_ARTIFACT_SOFT_DELETE_DAYS`
- `RUNNER_ARTIFACT_HARD_DELETE_DAYS`
- `RUNNER_ARTIFACT_HARD_DELETE_BATCH_SIZE`

## Health Endpoints

- Liveness: `/api/health/live` (process up)
- Readiness: `/api/health/ready` (core app readiness, DB required)
- Dependency diagnostics: `/api/health/dependencies` (storage check)

## Rollout Order

1. Deploy control plane service/deployment.
2. Deploy browser runner deployment.
3. Deploy maintenance cronjob.
4. Pair Android macOS runners to the control-plane URL.

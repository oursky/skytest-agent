# Helm Chart

This chart deploys the shared SkyTest control plane into Kubernetes.

## Workloads

The chart creates:

- a control-plane `Deployment` and `Service`
- a runner-maintenance `CronJob`
- optional ingress, HPA, and PDB resources

Browser runs execute inside the control-plane pods. Android execution remains external and is provided by paired macOS runners.

## Prerequisites

- Kubernetes cluster
- Helm 3
- a published application image that already contains Playwright Chromium
- a Kubernetes `Secret` containing runtime environment variables

## Required Runtime Secret Values

Create a secret with at least:

- `DATABASE_URL`
- `ENCRYPTION_SECRET` or `STREAM_TOKEN_SECRET`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`
- `AUTHGEAR_CLIENT_ID`
- `AUTHGEAR_ENDPOINT`
- `AUTHGEAR_REDIRECT_URI`

Common optional values:

- `STORAGE_SIGNED_URL_TTL_SECONDS`
- `STREAM_POLL_INTERVAL_MS`
- `RUNNER_LEASE_DURATION_SECONDS`
- `RUNNER_LEASE_REAPER_INTERVAL_MS`
- `RUNNER_EVENT_RETENTION_DAYS`
- `RUNNER_ARTIFACT_SOFT_DELETE_DAYS`
- `RUNNER_ARTIFACT_HARD_DELETE_DAYS`
- `RUNNER_ARTIFACT_HARD_DELETE_BATCH_SIZE`
- `RUNNER_MAX_CONCURRENT_RUNS`
- `PROJECT_MAX_CONCURRENT_RUNS_MAX`
- `LOG_LEVEL`
- `PRISMA_LOG_QUERIES`
- `UI_DEVICE_STATUS_POLL_INTERVAL_MS`

Example:

```bash
kubectl -n skytest create secret generic skytest-agent-secrets \
  --from-literal=DATABASE_URL='postgresql://...' \
  --from-literal=ENCRYPTION_SECRET='replace-me' \
  --from-literal=S3_ENDPOINT='https://s3.example.com' \
  --from-literal=S3_REGION='us-east-1' \
  --from-literal=S3_BUCKET='skytest-agent' \
  --from-literal=S3_ACCESS_KEY_ID='...' \
  --from-literal=S3_SECRET_ACCESS_KEY='...' \
  --from-literal=S3_FORCE_PATH_STYLE='false' \
  --from-literal=AUTHGEAR_CLIENT_ID='...' \
  --from-literal=AUTHGEAR_ENDPOINT='https://...' \
  --from-literal=AUTHGEAR_REDIRECT_URI='https://skytest.example.com/auth-redirect'
```

## Validate The Chart

```bash
helm lint infra/helm
helm template skytest infra/helm --set image.tag=<immutable-tag>
```

## Install Or Upgrade

```bash
helm upgrade --install skytest infra/helm \
  --namespace skytest \
  --create-namespace \
  --set image.repository=ghcr.io/oursky/skytest-agent \
  --set image.tag=<immutable-tag>
```

## Operational Notes

- `ingress.enabled` is `false` by default.
- `autoscaling.enabled` applies to the control-plane deployment.
- Scale browser throughput by changing control-plane resources or replica count.
- Pair Android macOS runners against the public control-plane URL after deployment.
- Updating a referenced `Secret` does not restart pods automatically. Run a Helm upgrade or restart workloads after secret changes.

## Health Endpoints

- liveness: `/api/health/live`
- readiness: `/api/health/ready`
- dependency diagnostics: `/api/health/dependencies`

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
- `GCS_BUCKET`
- `GCS_PROJECT_ID`
- `AUTHGEAR_CLIENT_ID`
- `AUTHGEAR_ENDPOINT`
- `AUTHGEAR_REDIRECT_URI`

Common optional values:

- `GCS_SERVICE_ACCOUNT_JSON_BASE64` (omit when using ADC/Workload Identity)
- `STORAGE_EMULATOR_HOST` (local emulator only)
- `STORAGE_SIGNED_URL_TTL_SECONDS`
- `STREAM_POLL_INTERVAL_MS`
- `STREAM_MAX_POLL_INTERVAL_MS`
- `RUNNER_HEARTBEAT_INTERVAL_SECONDS`
- `RUNNER_CLAIM_LONG_POLL_TIMEOUT_SECONDS`
- `RUNNER_DEVICE_SYNC_INTERVAL_SECONDS`
- `RUNNER_CLAIM_RETRY_INTERVAL_MS`
- `RUNNER_LEASE_DURATION_SECONDS`
- `RUNNER_LEASE_REAPER_INTERVAL_MS`
- `RUNNER_EVENT_RETENTION_DAYS`
- `RUNNER_ARTIFACT_SOFT_DELETE_DAYS`
- `RUNNER_ARTIFACT_HARD_DELETE_DAYS`
- `RUNNER_ARTIFACT_HARD_DELETE_BATCH_SIZE`
- `RUNNER_MAX_CONCURRENT_RUNS`
- `PROJECT_MAX_CONCURRENT_RUNS_MAX`
- `RUNNER_MAX_LOCAL_BROWSER_RUNS`
- `RUNNER_RUN_STATUS_POLL_INTERVAL_MS`
- `RUNNER_RUN_STATUS_MAX_POLL_INTERVAL_MS`
- `LOG_LEVEL`
- `PRISMA_LOG_QUERIES`
- `UI_DEVICE_STATUS_POLL_INTERVAL_MS`
- `RATE_LIMIT_STORE_MODE`
- `RUNNER_RATE_LIMIT_STORE_MODE`

Example:

```bash
kubectl -n skytest create secret generic skytest-agent-secrets \
  --from-literal=DATABASE_URL='postgresql://...' \
  --from-literal=ENCRYPTION_SECRET='replace-me' \
  --from-literal=GCS_BUCKET='skytest-agent' \
  --from-literal=GCS_PROJECT_ID='<gcp-project-id>' \
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

## Resource Profiles

Use one of the profile override files in `infra/helm/profiles`:

- `low.yaml`: lowest-cost baseline (matches current chart defaults) for small teams and low parallel browser load
- `standard.yaml`: balanced production baseline
- `high.yaml`: higher baseline for heavier browser concurrency

Examples:

```bash
# low-cost profile
helm upgrade --install skytest infra/helm \
  --namespace skytest \
  --create-namespace \
  --set image.repository=ghcr.io/oursky/skytest-agent \
  --set image.tag=<immutable-tag> \
  -f infra/helm/profiles/low.yaml

# standard profile
helm upgrade --install skytest infra/helm \
  --namespace skytest \
  --create-namespace \
  --set image.repository=ghcr.io/oursky/skytest-agent \
  --set image.tag=<immutable-tag> \
  -f infra/helm/profiles/standard.yaml

# high-throughput profile
helm upgrade --install skytest infra/helm \
  --namespace skytest \
  --create-namespace \
  --set image.repository=ghcr.io/oursky/skytest-agent \
  --set image.tag=<immutable-tag> \
  -f infra/helm/profiles/high.yaml
```

Recommended runtime env tuning per profile:

- `low`: `RUNNER_MAX_LOCAL_BROWSER_RUNS=1`, `RUNNER_MAX_CONCURRENT_RUNS=4`, `STREAM_POLL_INTERVAL_MS=5000`, `STREAM_MAX_POLL_INTERVAL_MS=30000`, `RUNNER_RUN_STATUS_POLL_INTERVAL_MS=5000`, `RUNNER_RUN_STATUS_MAX_POLL_INTERVAL_MS=30000`, `RUNNER_HEARTBEAT_INTERVAL_SECONDS=45`, `RUNNER_DEVICE_SYNC_INTERVAL_SECONDS=45`, `RUNNER_RATE_LIMIT_STORE_MODE=memory`.
- `standard`: use `.env.example` defaults.
- `high`: start with `RUNNER_MAX_LOCAL_BROWSER_RUNS=2`, `RUNNER_MAX_CONCURRENT_RUNS=20`, `STREAM_POLL_INTERVAL_MS=3000`, `STREAM_MAX_POLL_INTERVAL_MS=15000`, `RUNNER_RUN_STATUS_POLL_INTERVAL_MS=3000`, `RUNNER_RUN_STATUS_MAX_POLL_INTERVAL_MS=15000`, and tune upward from load-test evidence.

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

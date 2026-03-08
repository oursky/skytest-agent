# Helm Chart (Open Source Baseline)

This chart packages SkyTest Agent into three Kubernetes workloads:

- control plane (`next start`)
- browser runner worker (`npm run runner:browser`)
- runner maintenance cronjob (`npm run runner:maintenance` with `RUNNER_MAINTENANCE_ONCE=true`)

This open-source chart intentionally keeps secrets out of the repository.

## Prerequisites

- Kubernetes cluster
- Helm 3
- A Kubernetes Secret containing runtime environment variables

Create secret example:

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
  --from-literal=NEXT_PUBLIC_AUTHGEAR_CLIENT_ID='...' \
  --from-literal=NEXT_PUBLIC_AUTHGEAR_ENDPOINT='https://...' \
  --from-literal=NEXT_PUBLIC_AUTHGEAR_REDIRECT_URI='https://your-host/auth-redirect'
```

## Dry Run

```bash
helm lint deploy/helm
helm template skytest deploy/helm
```

## Install / Upgrade

```bash
helm upgrade --install skytest deploy/helm \
  --namespace skytest \
  --create-namespace \
  --set image.repository=ghcr.io/oursky/skytest-agent \
  --set image.tag=<immutable-tag>
```

## Notes

- `ingress.enabled` is `false` by default.
- `autoscaling.enabled` is `true` for control plane by default.
- Android `MACOS_AGENT` runners are external to this chart and must be paired separately.
- Health endpoints:
  - liveness: `/api/health/live`
  - readiness: `/api/health/ready`
  - dependency diagnostics: `/api/health/dependencies`

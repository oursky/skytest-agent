# Infrastructure

This directory contains the deployment artifacts that should stay in sync with the application runtime.

## Source Of Truth

- `infra/helm/` is the only Kubernetes deployment source of truth.
- `infra/docker/docker-compose.local.yml` is for local developer services only.

Do not keep a second set of raw Kubernetes manifests alongside the Helm chart. They drift.

## Runtime Topology

SkyTest runs in Kubernetes as two workloads:

- a control-plane `Deployment` for the Next.js web app, API routes, and browser test execution
- a runner-maintenance `CronJob` for lease recovery, queue sanitization, and retention tasks

Android execution does not run in the cluster. It is provided by external macOS runners paired to the deployed control plane.

## External Dependencies

Shared deployments require:

- PostgreSQL
- Google Cloud Storage (GCS)
- Authgear
- one or more external macOS runners if your teams run Android test cases

## Image Requirements

The application image must:

- include Playwright Chromium
- be environment-agnostic so the same image can be promoted across staging and production

Deployment-specific configuration is supplied at runtime through Kubernetes secrets and values, not at image build time.

## Next Steps

- [Helm chart deployment guide](./helm/README.md)
- [Local development services](../docs/operators/local-development.md)
- [Android runtime deployment checklist](../docs/operators/android-runtime-deployment-checklist.md)

# Local Orchestration Makefile

The repo now uses a top-level `Makefile` for environment orchestration instead of a shell wrapper.

## Goals

- Keep JavaScript package scripts focused on app and runner execution.
- Put multi-step local workflows in a tool built for orchestration.
- Make local and deployment entry points follow the same variable-driven shape.

## Local Targets

- `make bootstrap` installs dependencies, starts local services, and applies the Prisma schema.
- `make dev` starts local services, applies the schema, and runs the Next.js control plane.
- `make dev-browser` adds the hosted browser runner to the same session.
- `make dev-macos` adds the macOS runner to the same session.
- `make dev-all` starts both runners plus the control plane.

## Deployment Shape

The `Makefile` keeps deployment values in overridable variables instead of embedding environment-specific paths or names in target bodies:

- `K8S_NAMESPACE`
- `K8S_APP_NAME`
- `K8S_DEPLOYMENT`
- `K8S_MANIFEST_DIR`
- `KUBECTL`

This keeps the target naming consistent between local development and Kubernetes automation while allowing CI or operators to inject environment-specific values.

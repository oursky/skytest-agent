# Local Orchestration Makefile

The repo uses a top-level `Makefile` for local environment orchestration.

## Goals

- Keep JavaScript package scripts focused on app and runner execution.
- Put multi-step local workflows in a tool built for orchestration.
- Keep local workflows deterministic for maintainers and coding agents.

## Local Targets

- `make bootstrap` installs dependencies, starts local services, and applies the Prisma schema.
- `make dev` starts local services, applies the schema, and runs:
  - Next.js control plane
  - runner maintenance worker loop
- `make runner-reset` clears local runner state between development cycles.

## Core Variables

The current targets rely on these overridable variables:

- `NODE_PM`
- `COMPOSE`
- `COMPOSE_FILE`
- `CONTROL_PLANE_HOST`
- `CONTROL_PLANE_PORT`
- `CONTROL_PLANE_URL`

These variables keep local workflows customizable without embedding host-specific values into target bodies.

# Architecture Target State (Initial Draft)

Date: 2026-04-03  
Phase: 0 baseline draft

## 1. Purpose

Define the target architecture for sustainable long-term maintenance across:
- `apps/web`
- `apps/cli`
- `apps/macos-runner`
- `packages/runner-protocol`

This draft sets boundary contracts and decomposition direction for Phase 1+ execution.

## 2. Design Principles

1. Transport must stay thin and never own business rules.
2. Domain services own orchestration and policy decisions.
3. Side effects (DB, network, process, filesystem) must be isolated behind adapters.
4. Shared contracts must live in `packages/runner-protocol`; consumers must not depend on package internals.
5. Runtime behavior changes must preserve queue/dispatch/cancel parity.
6. Security guardrails are deny-by-default for API routes.

## 3. Layer Model

Standard layers used in this repository:
- `transport`: HTTP routes, CLI command handlers, external entrypoints
- `service`: domain logic and orchestration helpers
- `runtime`: execution pipeline and lifecycle state transitions
- `worker`: long-running loops and scheduler cycles
- `persistence`: Prisma/data access and storage adapters
- `UI`: Next.js pages/components and feature state orchestration
- `protocol`: shared DTOs/events/contracts
- `MCP`: MCP transport, registry, tool execution contracts
- `config`: configuration loading/validation
- `i18n`: localization catalog + translation access

## 4. Domain Boundaries

### 4.1 Web API (`apps/web/src/app/api`)

Target boundary:
- route handlers do auth, validation, response mapping only
- ownership/resource checks delegated to shared guard helpers
- domain actions delegated to `apps/web/src/lib/**` services

Contract:
- route handlers return standardized typed result shape
- auth failure, forbidden, not found, and validation errors mapped consistently

### 4.2 Web Services (`apps/web/src/lib`)

Target boundary:
- runtime/runners/test-cases/test-config/security/storage modules are domain-owned
- persistence access centralized through singleton Prisma and adapters
- no cross-domain hidden imports that bypass service interfaces

Contract:
- services expose explicit input/output types
- no implicit mutation across module boundaries

### 4.3 Runtime + Workers (`apps/web/src/lib/runtime`, `apps/web/src/workers`)

Target boundary:
- runtime pipeline modules are stage-oriented (plan, claim, execute, persist, notify)
- worker loops own scheduling cadence and retries only
- execution logic remains idempotent and restart-safe

Contract:
- each stage defines deterministic transition rules
- restart mid-cycle cannot duplicate processing or lose work

### 4.4 Frontend (`apps/web/src/app`, `apps/web/src/components`)

Target boundary:
- pages are orchestration shells
- feature hooks/models own state derivation and async flow
- reusable selectors/transformers shared for runs/projects/test-cases

Contract:
- UI state transitions are predictable and testable
- API shape assumptions are centralized in typed client boundaries

### 4.5 CLI (`apps/cli`)

Target boundary:
- command adapters parse/validate CLI input
- runtime manager owns lifecycle orchestration
- state/process/control-plane concerns are split by module

Contract:
- command modules do not perform process supervision directly
- control-plane API contract version remains explicit

### 4.6 macOS Runner (`apps/macos-runner`)

Target boundary:
- engine lifecycle stages mirror web runtime semantics where applicable
- process and credential management remain adapter-level concerns

Contract:
- host capabilities and heartbeat/job event payloads adhere to protocol package contracts

### 4.7 Runner Protocol (`packages/runner-protocol`)

Target boundary:
- protocol is the only cross-process contract source
- package public exports define allowed surface

Contract:
- direct `@skytest/runner-protocol/src/*` imports are prohibited
- schema/DTO changes require compatibility review and versioning decision

### 4.8 MCP (`apps/web/src/lib/mcp`, `apps/web/src/app/api/mcp`)

Target boundary:
- transport/auth boundary separated from registry and tool dispatch
- each tool has explicit input schema and response contract

Contract:
- MCP manifest (tool names/input schema/response shape) is compatibility-gated by snapshot tests

## 5. Dependency Rules

1. `transport` can depend on `service`, `protocol`, `config`, `i18n`.
2. `service` can depend on `persistence`, `protocol`, `config`.
3. `runtime` can depend on `service`, `persistence`, `protocol`, `config`.
4. `worker` can depend on `runtime`, `service`, `protocol`, `config`.
5. `UI` can depend on typed client contracts and `i18n`, not server internals.
6. `protocol` cannot depend on app-specific runtime or transport code.
7. `MCP` tool execution must not bypass auth and ownership checks.

## 6. Hotspot Decomposition Targets

Priority hotspots and target outcomes:
- `apps/web/src/lib/runtime/test-runner.ts`: split into execution pipeline modules with parity tests
- `apps/web/src/lib/runtime/local-browser-runner.ts`: split by lifecycle stages and adapter boundaries
- `apps/web/src/lib/mcp/server.ts`: split into transport, registry, dispatcher, response shaping modules
- `apps/web/src/app/run/page.tsx`: move non-render orchestration into feature hooks/models
- `apps/web/src/app/projects/[id]/page.tsx`: split data orchestration and derived selectors
- `apps/macos-runner/runner/engine.ts`: split lifecycle core from process/IO adapters
- `apps/cli/src/runtime/runner-manager.ts`: split orchestration vs process supervision vs persistence

## 7. Migration Safety Model

All schema/data transitions follow:
1. Expand
2. Migrate/backfill
3. Contract

Required per migration:
- invariants documented
- rollback strategy documented
- index safety checked
- no destructive drop in same release as expand/migrate

## 8. Quality Gates

Mandatory gates before merge for relevant slices:
- `npm run verify`
- deny-by-default API auth-route coverage check
- protocol import-boundary check
- parity tests for queue/dispatch/cancel/events paths
- SSE load gate for `/api/test-runs/[id]/events` impacting slices

## 9. Target Completion Signals

Architecture target state is considered established when:
1. all tracked TS/TSX files are mapped to a boundary/layer in review matrix
2. allowlisted unauthenticated routes are explicit and verified in automation
3. protocol contract boundaries are enforced in CI
4. decomposition slices ship without parity regressions

# Auth Route Allowlist (Draft)

Date: 2026-04-03  
Phase: 0 draft

## 1. Purpose

Define explicit exceptions for API routes that do not use `verifyAuth(request)`.

This allowlist is the source of truth for deny-by-default auth coverage checks. Any API `route.ts` missing `verifyAuth` must either:
1. use an approved alternative guard, or
2. be explicitly listed here with rationale.

## 2. Allowed Patterns

- `verifyAuth`: user session/JWT-based guard for operator/user routes.
- `authenticateRunnerRequest`: runner credential/authentication guard for runner protocol endpoints.
- `pairingTokenExchange`: one-time pairing token exchange flow for initial runner credential bootstrap.
- `publicReadiness`: unauthenticated health probes for service orchestration.
- `publicTelemetry`: unauthenticated beacon telemetry with strict payload validation and rate limit.
- `publicProxy`: unauthenticated proxy endpoint guarded by strict allowlist + rate limit.
- `nonOperational405`: endpoint intentionally returns `405` only and performs no state mutation.

## 3. Route Allowlist

| Route file | Methods | Guard mode | Reason |
|---|---|---|---|
| `apps/web/src/app/api/health/live/route.ts` | `GET` | `publicReadiness` | liveness probe for infra and orchestration |
| `apps/web/src/app/api/health/ready/route.ts` | `GET` | `publicReadiness` | readiness probe for orchestration and health checks |
| `apps/web/src/app/api/health/dependencies/route.ts` | `GET` | `publicReadiness` | dependency probe used by operator diagnostics |
| `apps/web/src/app/api/authgear-proxy/route.ts` | `GET,POST,PUT,PATCH,DELETE` | `publicProxy` | auth-provider proxy path protected by endpoint allowlist + rate limiting |
| `apps/web/src/app/api/telemetry/web-vitals/route.ts` | `POST` | `publicTelemetry` | browser `sendBeacon` telemetry before auth bootstrap |
| `apps/web/src/app/api/projects/[id]/avd-profiles/[profileId]/route.ts` | `PATCH,DELETE` | `nonOperational405` | endpoint does not mutate; always returns 405 with explanatory error |
| `apps/web/src/app/api/runners/v1/pairing/exchange/route.ts` | `POST` | `pairingTokenExchange` | bootstrap exchange from pairing token to runner credential |
| `apps/web/src/app/api/runners/v1/credential/verify/route.ts` | `POST` | `authenticateRunnerRequest` | verify and refresh runner credential/session metadata |
| `apps/web/src/app/api/runners/v1/register/route.ts` | `POST` | `authenticateRunnerRequest` | runner registration with authenticated runner identity |
| `apps/web/src/app/api/runners/v1/repair/route.ts` | `POST` | `authenticateRunnerRequest` | host binding repair restricted to authenticated runner |
| `apps/web/src/app/api/runners/v1/heartbeat/route.ts` | `POST` | `authenticateRunnerRequest` | heartbeat updates for authenticated runner |
| `apps/web/src/app/api/runners/v1/devices/sync/route.ts` | `POST` | `authenticateRunnerRequest` | device inventory sync for authenticated runner |
| `apps/web/src/app/api/runners/v1/jobs/claim/route.ts` | `POST` | `authenticateRunnerRequest` | job claim allowed only for authenticated runner |
| `apps/web/src/app/api/runners/v1/jobs/[id]/details/route.ts` | `POST` | `authenticateRunnerRequest` | job detail access restricted to authenticated runner |
| `apps/web/src/app/api/runners/v1/jobs/[id]/events/route.ts` | `POST` | `authenticateRunnerRequest` | event ingestion restricted to authenticated runner |
| `apps/web/src/app/api/runners/v1/jobs/[id]/artifacts/route.ts` | `POST` | `authenticateRunnerRequest` | artifact upload restricted to authenticated runner |
| `apps/web/src/app/api/runners/v1/jobs/[id]/complete/route.ts` | `POST` | `authenticateRunnerRequest` | completion updates restricted to authenticated runner |
| `apps/web/src/app/api/runners/v1/jobs/[id]/fail/route.ts` | `POST` | `authenticateRunnerRequest` | failure updates restricted to authenticated runner |
| `apps/web/src/app/api/runners/v1/shutdown/route.ts` | `POST` | `authenticateRunnerRequest` | shutdown handshake restricted to authenticated runner |
| `apps/web/src/app/api/runners/v1/unpair/route.ts` | `POST` | `authenticateRunnerRequest` | unpair action restricted to authenticated runner |

## 4. Governance Rules

1. Any new non-`verifyAuth` API route must be added here in the same PR.
2. Any removed route must be removed here in the same PR.
3. CI auth coverage checks must fail if an unlisted non-`verifyAuth` route appears.
4. A `Guard mode` change in this file requires security review.

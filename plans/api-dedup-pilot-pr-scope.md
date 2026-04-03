# API Dedup Pilot PR Scope

Date: 2026-04-03  
Task: Immediate action 13

## 1. Pilot Objective

Run the first low-risk vertical slice to reduce repeated API route boilerplate while preserving existing behavior.

Primary target:
- standardize auth guard and error response handling with the new `api-route-standards` helpers

## 2. In-Scope Files (Pilot)

Route group:
- `apps/web/src/app/api/projects/[id]/configs/route.ts`
- `apps/web/src/app/api/projects/[id]/configs/[configId]/route.ts`
- `apps/web/src/app/api/projects/[id]/configs/groups/route.ts`
- `apps/web/src/app/api/projects/[id]/configs/upload/route.ts`
- `apps/web/src/app/api/projects/[id]/configs/[configId]/download/route.ts`

Shared helpers (existing/new):
- `apps/web/src/lib/security/api-route-standards.ts`
- optional focused helper extraction under `apps/web/src/lib/security/` if duplication remains after pilot

## 3. Out of Scope

- changing external response payload shape for successful requests
- schema/data-model changes
- team/runner/test-run routes

## 4. Planned Refactor Steps

1. Replace inline auth/resolve-user checks with `guardAuthenticatedUser`.
2. Replace repeated unauthorized/forbidden/not-found responses with `apiError` helper calls.
3. Keep existing ownership/resource checks intact; only route boilerplate is deduplicated.
4. Keep route-level business logic untouched unless required to compile.

## 5. Success Criteria

1. Behavior parity for all touched endpoints.
2. Net reduction in repeated auth/error boilerplate lines across pilot routes.
3. `npm run verify` passes.
4. No new unauthenticated route exceptions introduced.

## 6. Validation Plan

- run route-focused tests for project config APIs
- run `npm run verify` (includes auth coverage check)
- manual smoke for config list/create/update/delete/download/upload

## 7. Risks and Mitigations

- Risk: subtle response contract drift
  - Mitigation: preserve status codes and response keys; compare pre/post snapshots for pilot routes
- Risk: ownership checks accidentally moved or weakened
  - Mitigation: keep ownership predicates in-place; limit changes to guard/response wrappers

## 8. Rollback Rule

If any pilot route regresses authz, status codes, or payload compatibility:
1. revert pilot PR only
2. split into smaller per-route follow-up PRs

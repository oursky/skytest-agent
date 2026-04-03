# API Guard and Response Standards

Date: 2026-04-03  
Task: Immediate action 11

## Standard Module

Defined in:
- `apps/web/src/lib/security/api-route-standards.ts`

Exports:
- `guardAuthenticatedUser(request)`
- `apiError({ status, code, error, details? })`
- `apiOk(data, status?)`
- typed contracts: `ApiErrorCode`, `ApiErrorResponse`, `ApiSuccessResponse<T>`, `ApiUserGuardResult`

## Guard Contract

`guardAuthenticatedUser` returns a discriminated union:

- `ok: true`
  - includes `{ authPayload, userId }`
- `ok: false`
  - includes prebuilt `NextResponse<ApiErrorResponse>`

This enables routes to short-circuit auth failures without repeating response-shape boilerplate.

## Response Contract

Error response shape:

```json
{
  "error": "Unauthorized",
  "code": "UNAUTHORIZED",
  "details": {}
}
```

Success response shape:

```json
{
  "data": {}
}
```

## Adoption Plan

1. Apply to pilot route group in Phase 2a (project/test-case endpoints).
2. Keep existing external payloads where backward compatibility is required; use wrapper helpers for internal consistency first.
3. Expand route-by-route with snapshot checks for externally visible response contracts.

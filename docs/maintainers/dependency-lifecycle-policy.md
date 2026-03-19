# Dependency Lifecycle Policy

This policy defines how SkyTest dependencies are reviewed and updated to keep the project maintainable for long-term operation.

## Scope

Applies to:

- npm workspace dependencies (`package.json` + lockfile)
- runtime infrastructure dependencies (Node.js, Playwright, Prisma)
- schema and index lifecycle for PostgreSQL

## Update Cadence

1. Weekly:
- run security audit and review new advisories
- patch high/critical CVEs immediately

2. Monthly:
- update non-breaking dependencies (`minor` and `patch`)
- run CI + load-gate workflow before merge

3. Quarterly:
- review and plan major upgrades for core stack:
  - Node.js LTS
  - Next.js
  - Prisma
  - Playwright
  - `@skytest/runner-protocol`

4. Yearly:
- retire unsupported runtime versions
- refresh baseline performance thresholds (claim latency, DB tx/s, memory)

## Database Schema and Index Review

1. Monthly:
- inspect top slow queries and table/index bloat
- verify runner/claim/event paths still use expected indexes

2. For every schema change:
- include rollback notes in PR
- evaluate index impact and migration lock risk
- document retention policy impact (event/artifact tables)

## Breaking-Change Process

1. Record rationale and migration plan in PR description.
2. Land code and schema in dependency order.
3. Update operator and maintainer docs in the same PR.
4. Re-run CI and load-gate before release.

## Ownership

- Maintainers own update execution and release safety.
- All changes to dependency policy must be reviewed by at least one maintainer.

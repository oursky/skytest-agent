# Fly/Supabase Runtime Pre-Deploy Readiness

Status date: 2026-03-18
Scope: `skytest-agent` runtime repository only

This document records non-production completion evidence for the hard cutover to Supabase Postgres + S3-compatible object storage (Fly Tigris in production, MinIO locally).

## Completed in this repo

- Legacy runtime flow removed (old cloud-storage and old orchestration deployment contracts)
- Runtime storage path is S3-only
- Local stack is MinIO-based
- CI includes legacy denylist + SHA pinning + secret scanning
- Browser-run reliability/recovery improvements are in place
- Runtime docs were updated to Fly/S3 assumptions

## Verification evidence (local)

Executed on 2026-03-18:

- `npm run --workspace @skytest/web test` -> pass (41 files, 150 tests)
- `npm run --workspace @skytest/web lint` -> pass
- `npm run --workspace @skytest/web build` -> pass
- `npm run --workspace @skytest/web verify` -> pass (includes `npm audit`, 0 vulnerabilities)
- `S3_ENDPOINT=http://127.0.0.1:9000 S3_REGION=us-east-1 S3_BUCKET=skytest-agent S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin S3_FORCE_PATH_STYLE=true npm run --workspace @skytest/web smoke:storage` -> pass

Static hygiene scans:

- no active references to removed legacy storage env/adapter contracts
- no active references to removed legacy orchestrator deployment instructions
- no obvious hardcoded production secret material in tracked files

## Stop point

This repo is ready for deployment handoff.

Intentionally not executed here:

- production deployment execution to `skytest-oursky.fly.dev`
- post-deploy production soak and recovery drills

## Known limitation to track

- Midscene API-key injection currently uses process-level environment mutation and a global lock in `apps/web/src/lib/runtime/midscene-env.ts`. This is acceptable for initial single-tenant launch but should be refactored to remove global mutation for higher-concurrency multi-tenant isolation.

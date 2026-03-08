# Local Development

Use the same infrastructure shape in local development and hosted environments:
- PostgreSQL for application state
- S3-compatible object storage (MinIO) for files and artifacts

## Prerequisites

- Docker Engine with Compose (or Docker Desktop)
- Node.js matching the repo toolchain

## Quick Start

```bash
npm install
make dev
```

`make dev` starts:
- Postgres and MinIO
- Prisma schema sync
- Next.js control plane on `http://127.0.0.1:3000`
- browser runner worker loop (claimed browser run execution)
- runner maintenance worker loop (lease recovery + retention)

## Local Environment Variables

Set these values in `.env.local`:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/skytest_agent?schema=public"
S3_ENDPOINT="http://127.0.0.1:9000"
S3_REGION="us-east-1"
S3_BUCKET="skytest-agent"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_FORCE_PATH_STYLE="true"
STORAGE_SIGNED_URL_TTL_SECONDS="900"
STREAM_POLL_INTERVAL_MS="1500"
RUNNER_ARTIFACT_SOFT_DELETE_DAYS="30"
RUNNER_ARTIFACT_HARD_DELETE_DAYS="7"
RUNNER_ARTIFACT_HARD_DELETE_BATCH_SIZE="50"
```

Retention behavior:
- runs older than `RUNNER_ARTIFACT_SOFT_DELETE_DAYS` are soft-deleted
- soft-deleted runs are permanently removed after `RUNNER_ARTIFACT_HARD_DELETE_DAYS`
- hard delete runs in batches via `RUNNER_ARTIFACT_HARD_DELETE_BATCH_SIZE`

## Runtime Behavior

- Browser runs are queued and claimed by the browser runner worker.
- Android runs require a paired CLI runner process.

Runner environment and model configuration:
- [CLI Runner Environment Configuration](./cli-runner-env.md)

## CLI Runner Lifecycle (Source)

Pair and manage from this repo:

```bash
npm run skytest -- pair runner "<pairing-token>" --control-plane-url "http://127.0.0.1:3000"
npm run skytest -- get runners
npm run skytest -- start runner <local-runner-id>
npm run skytest -- stop runner <local-runner-id>
npm run skytest -- logs runner <local-runner-id> --tail 200
npm run skytest -- unpair runner <local-runner-id>
```

## CLI Runner Lifecycle (Homebrew)

```bash
brew install <tap>/skytest
skytest --help
skytest get runners
brew upgrade <tap>/skytest
```

## Clean Reset For Development

Reset runner state:

```bash
npm run skytest -- reset --force
```

Reset Homebrew runner state:

```bash
skytest reset --force
brew uninstall skytest
rm -rf "$(brew --prefix)/var/skytest"
```

Reset local services and data:

```bash
make services-down
docker compose -f docker-compose.local.yml down -v
make services-up
npm run db:generate
npx prisma db push
```

## Service Operations

Start/stop/log services:

```bash
make services-up
make services-down
make services-logs
```

## Verify MinIO

- API: `http://127.0.0.1:9000`
- Console: `http://127.0.0.1:9001`
- Default username/password: `minioadmin` / `minioadmin`

Confirm bucket `skytest-agent` exists.

## Troubleshooting

### Port already in use

If `5432`, `9000`, or `9001` is in use, stop the conflicting process or adjust `docker-compose.local.yml` host port mappings.

### Bucket not created

Run:

```bash
docker compose -f docker-compose.local.yml run --rm createbuckets
```

### Runner shows 401 after unpair from web portal

The local runner entry is cleaned up after the next unauthorized runner request. If needed, run:

```bash
npm run skytest -- reset --force
```

### Android runner setup details

See [macOS Android Runner Setup Guide](./mac-android-emulator-guide.md).

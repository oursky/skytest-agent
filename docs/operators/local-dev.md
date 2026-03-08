# Local Development

Use the same infrastructure shape in local development and hosted environments:
- PostgreSQL for application state
- S3-compatible object storage for files and artifacts

For local work, run MinIO as the S3-compatible service.

## Prerequisites

- Docker Desktop or Docker Engine with Compose
- Node.js matching the repo toolchain

## Start Local Services

```bash
make services-up
```

This starts:
- Postgres on `127.0.0.1:5432`
- MinIO API on `127.0.0.1:9000`
- MinIO console on `127.0.0.1:9001`
- A one-shot bucket bootstrap job that creates `skytest-agent`

To stop the services:

```bash
make services-down
```

To follow local service logs:

```bash
make services-logs
```

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
```

Keep the rest of your existing auth and app settings in `.env.local`.

## Start The App

```bash
npm install
make dev
```

Open `http://localhost:3000`.

## Quick Local Workflows

For local development, run the same infrastructure shape as hosted:
- PostgreSQL
- S3-compatible object storage via MinIO

Quick start:

```bash
make dev
```

Runtime processes:
- Browser runs are executed automatically by the control plane per test run
- Android runs require `skytest` runner lifecycle commands (source: `npm run skytest -- ...`, Homebrew: `skytest ...`)

CLI runner management from source:

```bash
npm run skytest -- pair runner "<pairing-token>" --control-plane-url "http://127.0.0.1:3000"
npm run skytest -- get runners
npm run skytest -- start runner <local-runner-id>
npm run skytest -- stop runner <local-runner-id>
npm run skytest -- logs runner <local-runner-id> --tail 200
npm run skytest -- unpair runner <local-runner-id>
```

Reset local runner environment during development:

```bash
npm run skytest -- reset --force
```

Homebrew user workflow:

```bash
brew install <tap>/skytest
skytest --help
skytest get runners
brew upgrade <tap>/skytest
```

Homebrew uninstall and cleanup:

```bash
skytest reset --force
brew uninstall skytest
rm -rf "$(brew --prefix)/var/skytest"
```

## Start Runner Processes (Phase 3)

Browser tests are executed directly by the control plane and spawn/close browsers per run.
Only Android execution requires a runner process.

### CLI runner (required for Android test runs)

See the full setup guide:

- [macOS Android Devices Guide](./mac-android-emulator-guide.md)

Quick start:
Generate the pairing token from `Team Settings -> Runners` in the web app.

```bash
npm run skytest -- pair runner "<pairing-token>" \
  --control-plane-url "http://127.0.0.1:3000" \
  --label "Local macOS Runner"
```

After pairing, manage lifecycle with:

```bash
npm run skytest -- get runners
npm run skytest -- start runner <local-runner-id>
npm run skytest -- stop runner <local-runner-id>
npm run skytest -- unpair runner <local-runner-id>
```

To cleanly reset local runner environment:

```bash
npm run skytest -- reset --force
```

## Verify MinIO

Open the MinIO console at `http://127.0.0.1:9001`.

Default credentials:
- username: `minioadmin`
- password: `minioadmin`

Confirm the `skytest-agent` bucket exists.

## Manage Local Object Storage

Use either:
- the MinIO console at `http://127.0.0.1:9001`
- the MinIO CLI client through `docker compose`

The console is fine for ad-hoc inspection.
Use the CLI when you want repeatable cleanup commands.

### List buckets

```bash
docker compose -f docker-compose.local.yml run --rm createbuckets \
  /bin/sh -c 'mc alias set local http://minio:9000 minioadmin minioadmin && mc ls local'
```

### List objects in the app bucket

```bash
docker compose -f docker-compose.local.yml run --rm createbuckets \
  /bin/sh -c 'mc alias set local http://minio:9000 minioadmin minioadmin && mc ls --recursive local/skytest-agent'
```

### Remove one object

Replace `<object-key>` with the full object key, for example `test-cases/<id>/files/<uuid>.pdf`.

```bash
docker compose -f docker-compose.local.yml run --rm createbuckets \
  /bin/sh -c 'mc alias set local http://minio:9000 minioadmin minioadmin && mc rm local/skytest-agent/<object-key>'
```

### Remove all objects under a prefix

Examples:
- all files for one test case: `test-cases/<test-case-id>/`
- all artifacts for one run: `test-runs/<run-id>/`

```bash
docker compose -f docker-compose.local.yml run --rm createbuckets \
  /bin/sh -c 'mc alias set local http://minio:9000 minioadmin minioadmin && mc rm --recursive --force local/skytest-agent/<prefix>'
```

### Empty the whole app bucket

Use this when you want to clear local object storage without destroying the bucket itself.

```bash
docker compose -f docker-compose.local.yml run --rm createbuckets \
  /bin/sh -c 'mc alias set local http://minio:9000 minioadmin minioadmin && mc rm --recursive --force local/skytest-agent'
```

### Remove and recreate the whole bucket

Use this only when you want a full local reset of object storage metadata and contents.

```bash
docker compose -f docker-compose.local.yml run --rm createbuckets \
  /bin/sh -c "mc alias set local http://minio:9000 minioadmin minioadmin && mc rb --force local/skytest-agent && mc mb local/skytest-agent && mc anonymous set private local/skytest-agent"
```

### Full local reset of Postgres and MinIO data

This removes the Docker volumes and deletes all local database and object storage data.

```bash
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml up -d
npm run db:generate
npx prisma db push
```

## Troubleshooting

### Port already in use

If `5432`, `9000`, or `9001` is already in use, stop the conflicting service or change the host port mappings in `docker-compose.local.yml`.

### Bucket not created

Run:

```bash
docker compose -f docker-compose.local.yml run --rm createbuckets
```

### Database schema not applied

Run:

```bash
npx prisma db push
```

### Browsers not installed for local test execution

Run:

```bash
npm run playwright:install
```

Then retry the browser run from the web UI.

### Object storage errors in the app

Check:
- MinIO is healthy on `http://127.0.0.1:9000/minio/health/live`
- `.env.local` points to `127.0.0.1:9000`
- the `skytest-agent` bucket exists
- `S3_FORCE_PATH_STYLE` is `true`

### Need to inspect or delete objects manually

Use the commands in `Manage Local Object Storage` above.
The most useful first checks are:
- list objects with `mc ls --recursive`
- remove one bad object with `mc rm`
- clear a whole prefix with `mc rm --recursive --force`

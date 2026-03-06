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
npm run dev:services:up
```

This starts:
- Postgres on `127.0.0.1:5432`
- MinIO API on `127.0.0.1:9000`
- MinIO console on `127.0.0.1:9001`
- A one-shot bucket bootstrap job that creates `skytest-agent`

To stop the services:

```bash
npm run dev:services:down
```

To follow local service logs:

```bash
npm run dev:services:logs
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
npm run db:generate
npx prisma db push
npm run dev
```

Open `http://localhost:3000`.

## Start Runner Processes (Phase 3)

The web app is now the control plane only. Runs are executed by runner processes.

### Browser runner (required for browser test runs)

Run this in a separate terminal after you have provisioned a `RUNNER_TOKEN` for a `HOSTED_BROWSER` runner:

```bash
RUNNER_CONTROL_PLANE_URL="http://127.0.0.1:3000" \
RUNNER_TOKEN="<browser-runner-token>" \
npm run runner:browser
```

### macOS runner (required for Android test runs)

See the full setup guide:

- [macOS Android Devices Guide](./mac-android-emulator-guide.md)

Quick start:

```bash
RUNNER_CONTROL_PLANE_URL="http://127.0.0.1:3000" \
RUNNER_PAIRING_TOKEN="<pairing-token>" \
npm run runner:macos
```

After first successful pairing, you can restart without `RUNNER_PAIRING_TOKEN`.

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

Then restart `npm run runner:browser`.

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

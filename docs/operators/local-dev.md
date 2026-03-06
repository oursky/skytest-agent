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
npm run db:migrate:dev
npm run dev
```

Open `http://localhost:3000`.

## Verify MinIO

Open the MinIO console at `http://127.0.0.1:9001`.

Default credentials:
- username: `minioadmin`
- password: `minioadmin`

Confirm the `skytest-agent` bucket exists.

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
npm run db:migrate:dev
```

### Object storage errors in the app

Check:
- MinIO is healthy on `http://127.0.0.1:9000/minio/health/live`
- `.env.local` points to `127.0.0.1:9000`
- the `skytest-agent` bucket exists
- `S3_FORCE_PATH_STYLE` is `true`

#!/usr/bin/env bash
# Maps platform-injected credentials onto SkyTest's env contract. Sourced by the runtime and
# migration entrypoints; a no-op anywhere the platform variables are absent.
#
# SkyRocket provisions Postgres and S3 and injects SKYROCKET_* variables into the container. Reading
# them here means no credential is ever copied by hand into a secret store, and rotating a resource
# needs no redeploy of configuration.
#
# Explicit values always win: if DATABASE_URL or S3_ENDPOINT is already set, nothing is overridden.

if [[ -z "${DATABASE_URL:-}" && -n "${SKYROCKET_POSTGRES_URL:-}" ]]; then
    # Prisma opens `num_cpus * 2 + 1` connections per client by default, per process. Three roles
    # against a small per-project connection budget exhausts it, and a rolling update doubles the
    # count while old and new pods overlap.
    db_param_separator='?'
    [[ "$SKYROCKET_POSTGRES_URL" == *"?"* ]] && db_param_separator='&'
    export DATABASE_URL="${SKYROCKET_POSTGRES_URL}${db_param_separator}connection_limit=${SKYTEST_DB_CONNECTION_LIMIT:-2}&pool_timeout=${SKYTEST_DB_POOL_TIMEOUT:-20}"
fi

if [[ -z "${S3_ENDPOINT:-}" && -n "${SKYROCKET_S3_ENDPOINT_URL:-}" ]]; then
    export S3_ENDPOINT="$SKYROCKET_S3_ENDPOINT_URL"
    export S3_REGION="${S3_REGION:-${SKYROCKET_S3_REGION:-us-east-1}}"
    # Run artifacts are served through presigned URLs, so the private bucket is the right target.
    export S3_BUCKET="${S3_BUCKET:-${SKYROCKET_S3_PRIVATE_BUCKET_NAME:-}}"
    export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-${SKYROCKET_S3_ACCESS_KEY:-}}"
    export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-${SKYROCKET_S3_SECRET_KEY:-}}"
    # rustfs, the S3 backend, addresses buckets by path rather than by subdomain.
    export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"
fi

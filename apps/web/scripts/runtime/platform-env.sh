#!/usr/bin/env bash
# Maps platform-injected credentials onto SkyTest's env contract. Sourced by the runtime and
# migration entrypoints; a no-op unless a platform prefix is configured.
#
# Some hosting platforms provision Postgres and object storage themselves and inject the connection
# details as environment variables under their own prefix. Reading them here means no credential is
# ever copied by hand into a secret store, and rotating a resource needs no configuration change.
#
# Set PLATFORM_CREDENTIAL_PREFIX to that prefix, trailing underscore included, and this script maps:
#
#   <PREFIX>POSTGRES_URL            -> DATABASE_URL (plus pool limits)
#   <PREFIX>S3_ENDPOINT_URL         -> S3_ENDPOINT
#   <PREFIX>S3_REGION               -> S3_REGION
#   <PREFIX>S3_PRIVATE_BUCKET_NAME  -> S3_BUCKET
#   <PREFIX>S3_ACCESS_KEY           -> S3_ACCESS_KEY_ID
#   <PREFIX>S3_SECRET_KEY           -> S3_SECRET_ACCESS_KEY
#
# Explicit values always win: if DATABASE_URL or S3_ENDPOINT is already set, nothing is overridden.

if [[ -n "${PLATFORM_CREDENTIAL_PREFIX:-}" ]]; then
    # Indirect expansion keeps this platform-agnostic: which platform is configuration, not code.
    __platform_read() {
        local name="${PLATFORM_CREDENTIAL_PREFIX}$1"
        printf '%s' "${!name:-}"
    }

    if [[ -z "${DATABASE_URL:-}" ]]; then
        __platform_pg_url=$(__platform_read POSTGRES_URL)
        if [[ -n "$__platform_pg_url" ]]; then
            # Prisma opens `num_cpus * 2 + 1` connections per client, per process. Several roles
            # against a small per-project budget exhausts it, and a rolling update doubles the count
            # while old and new containers overlap.
            __platform_separator='?'
            [[ "$__platform_pg_url" == *"?"* ]] && __platform_separator='&'
            export DATABASE_URL="${__platform_pg_url}${__platform_separator}connection_limit=${SKYTEST_DB_CONNECTION_LIMIT:-2}&pool_timeout=${SKYTEST_DB_POOL_TIMEOUT:-20}"
        fi
    fi

    if [[ -z "${S3_ENDPOINT:-}" ]]; then
        __platform_s3_endpoint=$(__platform_read S3_ENDPOINT_URL)
        if [[ -n "$__platform_s3_endpoint" ]]; then
            export S3_ENDPOINT="$__platform_s3_endpoint"
            export S3_REGION="${S3_REGION:-$(__platform_read S3_REGION)}"
            export S3_REGION="${S3_REGION:-us-east-1}"
            # Run artifacts are served through presigned URLs, so the private bucket is correct.
            export S3_BUCKET="${S3_BUCKET:-$(__platform_read S3_PRIVATE_BUCKET_NAME)}"
            export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-$(__platform_read S3_ACCESS_KEY)}"
            export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-$(__platform_read S3_SECRET_KEY)}"
            # These object stores address buckets by path rather than by subdomain.
            export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"
        fi
    fi

    unset -f __platform_read
    unset __platform_pg_url __platform_s3_endpoint __platform_separator
fi

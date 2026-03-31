#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "error: $*" >&2
  exit 1
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
PRISMA_DIR="$APP_DIR/prisma"
MIGRATIONS_DIR="$PRISMA_DIR/migrations"
SCHEMA_PATH="$PRISMA_DIR/schema.prisma"
TMP_WORK_DIR=""
FULL_DB_NAME=""
PREV_DB_NAME=""

make_db_url() {
  node - "$DATABASE_URL" "$1" <<'NODE'
const [baseUrl, dbName] = process.argv.slice(2);
const parsed = new URL(baseUrl);
parsed.pathname = `/${dbName}`;
console.log(parsed.toString());
NODE
}

non_comment_sql_exists() {
  local file_path="$1"
  grep -Ev '^[[:space:]]*(--|$)' "$file_path" | grep -q '.'
}

sanitize_diff_script() {
  local file_path="$1"
  sed -i.bak -E '/^Loaded Prisma config from /d; /^Prisma config detected, skipping environment variable loading\./d' "$file_path"
  rm -f "${file_path}.bak"
}

create_database() {
  local db_name="$1"
  local admin_url="$2"

  echo "DROP DATABASE IF EXISTS \"${db_name}\";" | npm exec --workspace @skytest/web -- prisma db execute --stdin --url "$admin_url" >/dev/null
  echo "CREATE DATABASE \"${db_name}\";" | npm exec --workspace @skytest/web -- prisma db execute --stdin --url "$admin_url" >/dev/null
}

drop_database() {
  local db_name="$1"
  local admin_url="$2"

  if [ -n "$db_name" ]; then
    echo "DROP DATABASE IF EXISTS \"${db_name}\";" | npm exec --workspace @skytest/web -- prisma db execute --stdin --url "$admin_url" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  local status=$?
  local admin_url=""

  if [ -n "${DATABASE_URL:-}" ]; then
    admin_url=$(make_db_url "postgres")
    drop_database "$FULL_DB_NAME" "$admin_url"
    drop_database "$PREV_DB_NAME" "$admin_url"
  fi

  if [ -n "$TMP_WORK_DIR" ] && [ -d "$TMP_WORK_DIR" ]; then
    rm -rf "$TMP_WORK_DIR"
  fi

  exit "$status"
}

trap cleanup EXIT INT TERM

if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL must be set"
fi

if [ ! -f "$SCHEMA_PATH" ]; then
  fail "Prisma schema not found at $SCHEMA_PATH"
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  fail "Migrations directory not found at $MIGRATIONS_DIR"
fi

migration_dirs=()
for path in "$MIGRATIONS_DIR"/*; do
  [ -d "$path" ] || continue
  migration_dirs+=("$(basename "$path")")
done

if [ "${#migration_dirs[@]}" -eq 0 ]; then
  fail "No migration directories found in $MIGRATIONS_DIR"
fi

IFS=$'\n' migration_dirs=($(printf '%s\n' "${migration_dirs[@]}" | sort))
unset IFS

random_suffix="$(date +%s)_${RANDOM}_$$"
FULL_DB_NAME="skytest_migrate_full_${random_suffix}"
PREV_DB_NAME="skytest_migrate_prev_${random_suffix}"
ADMIN_URL=$(make_db_url "postgres")
FULL_DB_URL=$(make_db_url "$FULL_DB_NAME")
PREV_DB_URL=$(make_db_url "$PREV_DB_NAME")

create_database "$FULL_DB_NAME" "$ADMIN_URL"

echo "Applying migrations to empty database from first migration"
DATABASE_URL="$FULL_DB_URL" npm exec --workspace @skytest/web -- prisma migrate deploy --schema "$SCHEMA_PATH" >/dev/null

echo "Re-applying migrations to verify idempotency"
DATABASE_URL="$FULL_DB_URL" npm exec --workspace @skytest/web -- prisma migrate deploy --schema "$SCHEMA_PATH" >/dev/null

if [ "${#migration_dirs[@]}" -lt 2 ]; then
  echo "Only one migration found; skipping rollback simulation"
  echo "Migration replay check passed"
  exit 0
fi

latest_index=$((${#migration_dirs[@]} - 1))
latest_migration="${migration_dirs[$latest_index]}"
TMP_WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/skytest-migration-check.XXXXXX")
TMP_PRISMA_DIR="$TMP_WORK_DIR/prisma"
mkdir -p "$TMP_PRISMA_DIR/migrations"
cp "$SCHEMA_PATH" "$TMP_PRISMA_DIR/schema.prisma"
if [ -f "$MIGRATIONS_DIR/migration_lock.toml" ]; then
  cp "$MIGRATIONS_DIR/migration_lock.toml" "$TMP_PRISMA_DIR/migrations/migration_lock.toml"
fi

for migration_dir in "${migration_dirs[@]}"; do
  if [ "$migration_dir" = "$latest_migration" ]; then
    continue
  fi
  cp -R "$MIGRATIONS_DIR/$migration_dir" "$TMP_PRISMA_DIR/migrations/$migration_dir"
done

create_database "$PREV_DB_NAME" "$ADMIN_URL"

echo "Applying migrations up to previous state (excluding latest: $latest_migration)"
DATABASE_URL="$PREV_DB_URL" npm exec --workspace @skytest/web -- prisma migrate deploy --schema "$TMP_PRISMA_DIR/schema.prisma" >/dev/null

ROLLBACK_SQL="$TMP_WORK_DIR/rollback.sql"
VERIFY_SQL="$TMP_WORK_DIR/rollback-verify.sql"

echo "Generating rollback SQL from latest schema to previous schema"
npm exec --workspace @skytest/web -- prisma migrate diff --from-url "$FULL_DB_URL" --to-url "$PREV_DB_URL" --script > "$ROLLBACK_SQL"
sanitize_diff_script "$ROLLBACK_SQL"

if non_comment_sql_exists "$ROLLBACK_SQL"; then
  echo "Applying generated rollback SQL"
  npm exec --workspace @skytest/web -- prisma db execute --url "$FULL_DB_URL" --file "$ROLLBACK_SQL" >/dev/null
else
  echo "Rollback diff is empty; no schema rollback SQL to apply"
fi

echo "Verifying rolled back schema matches previous schema"
npm exec --workspace @skytest/web -- prisma migrate diff --from-url "$FULL_DB_URL" --to-url "$PREV_DB_URL" --script > "$VERIFY_SQL"
sanitize_diff_script "$VERIFY_SQL"
if non_comment_sql_exists "$VERIFY_SQL"; then
  echo "Schema mismatch after rollback simulation:" >&2
  cat "$VERIFY_SQL" >&2
  fail "Rollback simulation failed"
fi

echo "Migration replay and rollback simulation passed"

#!/usr/bin/env bash
# Applies pending Prisma migrations, then exits. Intended as a pre-deploy job: a non-zero exit must
# stop the rollout, so the application never starts against a schema it was not built for.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$APP_DIR"

# shellcheck source=./platform-env.sh
source "$APP_DIR/scripts/runtime/platform-env.sh"

BIN_DIR="$(cd "$APP_DIR/../.." && pwd)/node_modules/.bin"
if [[ ! -x "$BIN_DIR/prisma" ]]; then
    BIN_DIR="$APP_DIR/node_modules/.bin"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "[migrate] DATABASE_URL is unset and no SKYROCKET_POSTGRES_URL was injected" >&2
    exit 78
fi

if [[ ! -x "$BIN_DIR/prisma" ]]; then
    echo "[migrate] cannot find the prisma CLI (looked in $BIN_DIR)" >&2
    exit 78
fi

echo "[migrate] applying migrations to ${DATABASE_URL%%\?*}"
exec node "$BIN_DIR/prisma" migrate deploy --schema prisma/schema.prisma

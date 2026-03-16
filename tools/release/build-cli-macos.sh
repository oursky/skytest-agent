#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-$(node -p "require('${ROOT_DIR}/package.json').version")}"
ARCH_INPUT="${2:-$(uname -m)}"

case "${ARCH_INPUT}" in
  x86_64|amd64)
    ARCH="amd64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported macOS architecture: ${ARCH_INPUT}" >&2
    exit 1
    ;;
esac

RELEASE_DIR="${ROOT_DIR}/dist/cli-release/${VERSION}"
PACKAGE_DIR_NAME="skytest-${VERSION}-darwin-${ARCH}"
PACKAGE_DIR="${RELEASE_DIR}/${PACKAGE_DIR_NAME}"
ARCHIVE_PATH="${RELEASE_DIR}/${PACKAGE_DIR_NAME}.tar.gz"

rm -rf "${PACKAGE_DIR}"
mkdir -p "${PACKAGE_DIR}"
mkdir -p "${PACKAGE_DIR}/apps"

cp "${ROOT_DIR}/package.json" "${PACKAGE_DIR}/package.json"
cp "${ROOT_DIR}/package-lock.json" "${PACKAGE_DIR}/package-lock.json"
cp -R "${ROOT_DIR}/packages" "${PACKAGE_DIR}/packages"
cp -R "${ROOT_DIR}/apps/macos-runner" "${PACKAGE_DIR}/apps/macos-runner"
cp -R "${ROOT_DIR}/apps/cli" "${PACKAGE_DIR}/apps/cli"
mkdir -p "${PACKAGE_DIR}/apps/web"
cp "${ROOT_DIR}/apps/web/package.json" "${PACKAGE_DIR}/apps/web/package.json"
cp "${ROOT_DIR}/apps/web/tsconfig.json" "${PACKAGE_DIR}/apps/web/tsconfig.json"
cp -R "${ROOT_DIR}/apps/web/prisma" "${PACKAGE_DIR}/apps/web/prisma"
cp -R "${ROOT_DIR}/apps/web/src" "${PACKAGE_DIR}/apps/web/src"

mkdir -p "${PACKAGE_DIR}/bin"
cat > "${PACKAGE_DIR}/bin/skytest" <<RUNNER_SCRIPT
#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
INSTALL_ROOT="\$(cd "\${SCRIPT_DIR}/.." && pwd)"

export SKYTEST_CLI_VERSION="${VERSION}"

exec node --import tsx "\${INSTALL_ROOT}/apps/cli/src/index.ts" "\$@"
RUNNER_SCRIPT
chmod +x "${PACKAGE_DIR}/bin/skytest"

cat > "${PACKAGE_DIR}/README-CLI-RELEASE.md" <<'README_EOF'
This archive is for Homebrew formula packaging.

Runtime requirements:
- macOS
- node (installed by Homebrew formula dependency)

Usage:
  ./bin/skytest --help
README_EOF

mkdir -p "${RELEASE_DIR}"
tar -C "${RELEASE_DIR}" -czf "${ARCHIVE_PATH}" "${PACKAGE_DIR_NAME}"

shasum -a 256 "${ARCHIVE_PATH}" > "${ARCHIVE_PATH}.sha256"
echo "Built ${ARCHIVE_PATH}"
cat "${ARCHIVE_PATH}.sha256"

#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-$(node -p "require('${ROOT_DIR}/package.json').version")}"
ARCH="${2:-$(uname -m)}"
RELEASE_DIR="${ROOT_DIR}/dist/cli-release/${VERSION}"
PACKAGE_DIR_NAME="skytest-${VERSION}-macos-${ARCH}"
PACKAGE_DIR="${RELEASE_DIR}/${PACKAGE_DIR_NAME}"
ARCHIVE_PATH="${RELEASE_DIR}/${PACKAGE_DIR_NAME}.tar.gz"

rm -rf "${PACKAGE_DIR}"
mkdir -p "${PACKAGE_DIR}"

cp "${ROOT_DIR}/package.json" "${PACKAGE_DIR}/package.json"
cp "${ROOT_DIR}/package-lock.json" "${PACKAGE_DIR}/package-lock.json"
cp "${ROOT_DIR}/tsconfig.json" "${PACKAGE_DIR}/tsconfig.json"
cp -R "${ROOT_DIR}/packages" "${PACKAGE_DIR}/packages"
cp -R "${ROOT_DIR}/cli-runner" "${PACKAGE_DIR}/cli-runner"
cp -R "${ROOT_DIR}/src" "${PACKAGE_DIR}/src"

mkdir -p "${PACKAGE_DIR}/bin"
cat > "${PACKAGE_DIR}/bin/skytest" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

exec node --import tsx "${INSTALL_ROOT}/packages/skytest-cli/src/index.ts" "$@"
EOF
chmod +x "${PACKAGE_DIR}/bin/skytest"

cat > "${PACKAGE_DIR}/README-CLI-RELEASE.md" <<'EOF'
This archive is for Homebrew formula packaging.

Runtime requirements:
- macOS
- node (installed by Homebrew formula dependency)

Usage:
  ./bin/skytest --help
EOF

mkdir -p "${RELEASE_DIR}"
tar -C "${RELEASE_DIR}" -czf "${ARCHIVE_PATH}" "${PACKAGE_DIR_NAME}"

shasum -a 256 "${ARCHIVE_PATH}" > "${ARCHIVE_PATH}.sha256"
echo "Built ${ARCHIVE_PATH}"
cat "${ARCHIVE_PATH}.sha256"

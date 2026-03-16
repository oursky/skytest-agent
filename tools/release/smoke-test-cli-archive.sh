#!/usr/bin/env bash

set -euo pipefail

ARCHIVE_PATH="${1:-}"

if [[ -z "${ARCHIVE_PATH}" ]]; then
  echo "Usage: tools/release/smoke-test-cli-archive.sh <archive-path>" >&2
  exit 1
fi

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Archive not found: ${ARCHIVE_PATH}" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/skytest-cli-smoke.XXXXXX)"
trap 'rm -rf "${TMP_DIR}"' EXIT

tar -xzf "${ARCHIVE_PATH}" -C "${TMP_DIR}"

PACKAGE_DIR="$(find "${TMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "${PACKAGE_DIR}" ]]; then
  echo "Failed to locate extracted package directory." >&2
  exit 1
fi

BUNDLED_RUNNER_PATH="${PACKAGE_DIR}/apps/macos-runner/dist/runner.bundle.cjs"
if [[ ! -f "${BUNDLED_RUNNER_PATH}" ]]; then
  echo "Bundled runner entry not found: ${BUNDLED_RUNNER_PATH}" >&2
  exit 1
fi

if [[ -d "${PACKAGE_DIR}/apps/web/src" ]]; then
  echo "Archive unexpectedly contains apps/web/src. Runner package should use bundled runtime." >&2
  exit 1
fi

PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PRISMA_SKIP_POSTINSTALL_GENERATE=1 npm ci --prefix "${PACKAGE_DIR}" >/dev/null

OUTPUT_PATH="${TMP_DIR}/runner-smoke.log"
set +e
RUNNER_CONTROL_PLANE_URL=http://127.0.0.1:9 \
RUNNER_TOKEN=dummy \
RUNNER_DISPLAY_ID=smokeid \
RUNNER_LABEL=smoke \
RUNNER_HOST_FINGERPRINT=smoke \
SKYTEST_RUNNER_STATE_DIR="${TMP_DIR}/state" \
SKYTEST_RUNNER_QUIET=1 \
node "${BUNDLED_RUNNER_PATH}" >"${OUTPUT_PATH}" 2>&1
RUN_STATUS=$?
set -e

if [[ "${RUN_STATUS}" -eq 0 ]]; then
  echo "Runner smoke test unexpectedly succeeded." >&2
  cat "${OUTPUT_PATH}" >&2
  exit 1
fi

if ! grep -q "Runner failed to start: fetch failed" "${OUTPUT_PATH}"; then
  echo "Runner smoke test failed for an unexpected reason." >&2
  cat "${OUTPUT_PATH}" >&2
  exit 1
fi

echo "Runner smoke test passed for ${ARCHIVE_PATH}"

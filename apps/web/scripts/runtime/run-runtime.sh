#!/usr/bin/env bash
# Runtime supervisor. Starts one or more SkyTest control-plane loops in a single container.
#
#   run-runtime.sh web maintenance worker   # everything in one container (Fly)
#   run-runtime.sh web maintenance          # request-serving pod
#   run-runtime.sh worker                   # browser-execution pod
#
# Roles:
#   web          Next.js server (the only role that listens on a port)
#   maintenance  lease reaping, retention, queue sanitation, and the scheduler tick
#   worker       browser runner — the only role that sets SKYTEST_BROWSER_WORKER=true
#
# At most one `worker` may run across the whole deployment: browser runs execute in-process
# against an in-memory capacity map, so a second dispatcher over-admits concurrent Chromium.
#
# Node is invoked directly rather than through `npm run` — each `npm run` is an extra Node
# process holding ~100 MiB purely to babysit its child. Heaps are capped explicitly because
# Node sizes max-old-space-size from host RAM, not the cgroup limit, and will grow toward
# multi-GB before GC gets serious inside a container.
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1
cd "$APP_DIR" || exit 1

BIN_DIR="$(cd "$APP_DIR/../.." && pwd)/node_modules/.bin"
if [[ ! -x "$BIN_DIR/next" ]]; then
    BIN_DIR="$APP_DIR/node_modules/.bin"
fi

readonly APP_DIR BIN_DIR
readonly BIND_HOST="${SKYTEST_BIND_HOST:-0.0.0.0}"
readonly BIND_PORT="${SKYTEST_BIND_PORT:-3000}"
readonly SHUTDOWN_GRACE_SECONDS="${SKYTEST_SHUTDOWN_GRACE_SECONDS:-240}"
readonly WEB_HEAP_MB="${SKYTEST_WEB_HEAP_MB:-256}"
readonly MAINTENANCE_HEAP_MB="${SKYTEST_MAINTENANCE_HEAP_MB:-128}"
readonly WORKER_HEAP_MB="${SKYTEST_WORKER_HEAP_MB:-320}"

declare -a CHILD_PIDS=()
terminating=0

log() {
    printf '[entrypoint] %s\n' "$*"
}

die() {
    printf '[entrypoint] %s\n' "$*" >&2
    exit 64
}

start_web() {
    NODE_OPTIONS="--max-old-space-size=${WEB_HEAP_MB}" \
    SKYTEST_BROWSER_WORKER=false \
        node "$BIN_DIR/next" start --hostname "$BIND_HOST" --port "$BIND_PORT" &
    CHILD_PIDS+=("$!")
}

start_maintenance() {
    # SKYTEST_SCHEDULER is overridable so operators can pause automated schedules while keeping
    # lease reaping and retention. SKYTEST_BROWSER_WORKER is not — that one is an invariant.
    NODE_OPTIONS="--max-old-space-size=${MAINTENANCE_HEAP_MB}" \
    SKYTEST_BROWSER_WORKER=false \
    RUNNER_MAINTENANCE_ONCE=false \
    SKYTEST_SCHEDULER="${SKYTEST_SCHEDULER:-true}" \
        node "$BIN_DIR/tsx" src/workers/runner-maintenance.ts &
    CHILD_PIDS+=("$!")
}

start_worker() {
    NODE_OPTIONS="--max-old-space-size=${WORKER_HEAP_MB}" \
    SKYTEST_BROWSER_WORKER=true \
        node "$BIN_DIR/tsx" src/workers/browser-runner.ts &
    CHILD_PIDS+=("$!")
}

signal_children() {
    local signal="$1" pid
    for pid in "${CHILD_PIDS[@]}"; do
        kill "-${signal}" "$pid" 2>/dev/null || true
    done
}

children_alive() {
    local pid
    for pid in "${CHILD_PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    done
    return 1
}

drain_children() {
    local waited=0
    while (( waited < SHUTDOWN_GRACE_SECONDS )); do
        children_alive || return 0
        sleep 1
        (( waited += 1 ))
    done
    log "grace period of ${SHUTDOWN_GRACE_SECONDS}s elapsed; forcing remaining children down"
    signal_children KILL
}

on_signal() {
    terminating=1
    log "received $1; forwarding to children"
    signal_children TERM
}

(( $# > 0 )) || die "usage: run-runtime.sh <role> [role...]   (roles: web maintenance worker)"

worker_count=0
for role in "$@"; do
    case "$role" in
        web|maintenance) ;;
        worker) (( worker_count += 1 )) ;;
        *) die "unknown role '$role' (expected: web, maintenance, worker)" ;;
    esac
done
(( worker_count <= 1 )) || die "at most one 'worker' role per container"

[[ -x "$BIN_DIR/next" ]] || die "cannot find node_modules/.bin/next (looked in $BIN_DIR)"

trap 'on_signal SIGTERM' TERM
trap 'on_signal SIGINT' INT

for role in "$@"; do
    "start_${role}"
done

log "supervising roles [$*] (pids: ${CHILD_PIDS[*]})"

wait -n
first_exit=$?

if (( terminating == 1 )); then
    drain_children
    log "shutdown complete"
    exit 0
fi

log "a child exited with status ${first_exit}; stopping siblings so the container restarts"
signal_children TERM
drain_children
exit 1

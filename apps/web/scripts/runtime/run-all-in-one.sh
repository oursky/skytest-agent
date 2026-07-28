#!/usr/bin/env bash
# Single-container entrypoint: runs the Next.js server, the browser runner worker,
# and the runner maintenance worker (which carries the scheduler tick) side by side.
#
# Exactly one child may set SKYTEST_BROWSER_WORKER=true: browser runs execute in-process
# and their capacity map lives in process memory, so a second dispatching process would
# over-admit concurrent Chromium instances.
#
# The supervisor forwards SIGTERM/SIGINT so each worker can drain in-flight runs, and exits
# non-zero as soon as any child dies so the platform restarts the whole container instead of
# leaving it serving HTTP with a dead worker.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1

readonly BIND_HOST="${SKYTEST_BIND_HOST:-0.0.0.0}"
readonly BIND_PORT="${SKYTEST_BIND_PORT:-3000}"
readonly SHUTDOWN_GRACE_SECONDS="${SKYTEST_SHUTDOWN_GRACE_SECONDS:-240}"

declare -a CHILD_PIDS=()
terminating=0

log() {
    printf '[entrypoint] %s\n' "$*"
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

trap 'on_signal SIGTERM' TERM
trap 'on_signal SIGINT' INT

SKYTEST_BROWSER_WORKER=true \
    npm run browser:worker &
CHILD_PIDS+=("$!")

SKYTEST_BROWSER_WORKER=false RUNNER_MAINTENANCE_ONCE=false SKYTEST_SCHEDULER=true \
    npm run runner:maintenance &
CHILD_PIDS+=("$!")

SKYTEST_BROWSER_WORKER=false \
    npm run start -- --hostname "$BIND_HOST" --port "$BIND_PORT" &
CHILD_PIDS+=("$!")

log "supervising browser worker, maintenance worker, web server (pids: ${CHILD_PIDS[*]})"

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

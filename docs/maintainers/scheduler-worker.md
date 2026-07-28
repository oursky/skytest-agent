# Scheduler tick

The scheduler polls persisted project schedules and enqueues runs through the same queue path used by manual execution. It runs as a step inside the **runner maintenance worker** loop (`src/workers/runner-maintenance.ts`) rather than as a separate process, so it needs no dedicated machine.

## Runtime model

- host: the runner maintenance worker (`npm run runner:maintenance`), whether it runs as its own
  container or as a child of [`run-all-in-one.sh`](../operators/single-container-deployment.md)
- enable flag: `SKYTEST_SCHEDULER=true` on the maintenance process
- cadence: one tick per maintenance cycle (`RUNNER_LEASE_REAPER_INTERVAL_MS`, default `60000`)
- per-tick cap: `SKYTEST_SCHEDULER_MAX_DUE_PER_TICK` default `50`
- domain logic: `src/lib/scheduler/scheduler-tick.ts` (`runSchedulerTick`)

The tick runs in its own error boundary (`runSchedulerTickSafely`): a scheduler failure is logged and never aborts the maintenance cycle (lease reaping, retention, queue sanitation), and a maintenance failure never blocks scheduling.

## Concurrency model

- due schedules are claimed with `FOR UPDATE SKIP LOCKED`
- `nextRunAt`, `lastRunAt`, and `lastEnqueuedAt` are advanced inside the same transaction
- multiple maintenance instances are safe (the claim guard prevents double-fire); steady state is one instance

## Failure model

- missed windows are not backfilled; the tick computes the next future occurrence from `now`
- a schedule whose `nextRunAt` can no longer be computed is disabled in-place so it cannot stall the claim loop
- enqueue failures are logged per test case and do not block other schedules in the same tick
- schedules created by users who no longer have project access keep advancing while enqueue attempts fail with `Forbidden`

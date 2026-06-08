# Scheduler worker

The scheduler worker polls persisted project schedules and enqueues runs through the same queue path used by manual execution.

## Runtime model

- entrypoint: `npm run --workspace @skytest/web scheduler:worker`
- enable flag: `SKYTEST_SCHEDULER=true`
- loop settings:
  - `SKYTEST_SCHEDULER_EVALUATION_INTERVAL_MS` default `30000`
  - `SKYTEST_SCHEDULER_MAX_DUE_PER_TICK` default `50`

## Concurrency model

- due schedules are claimed with `FOR UPDATE SKIP LOCKED`
- `nextRunAt`, `lastRunAt`, and `lastEnqueuedAt` are advanced inside the same transaction
- multiple worker instances are safe but unnecessary; steady state should remain one scheduler instance

## Failure model

- missed windows are not backfilled; the worker computes the next future occurrence from `now`
- enqueue failures are logged per test case and do not block other schedules in the same tick
- schedules created by users who no longer have project access will continue advancing while enqueue attempts fail with `Forbidden`

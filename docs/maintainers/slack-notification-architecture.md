# Slack Notification Architecture

## Scope

SkyTest can post Slack messages when a project run reaches `FAIL`.

## Trigger Paths

`runTerminal` events are emitted from all failure writers:

- `lib/runtime/local-browser-runner-lifecycle.ts`
- `lib/runners/event-service.ts`
- `lib/runners/lease-reaper.ts`
- `lib/runners/queue-sanitizer.ts`

## In-Process Bus

- `lib/runners/domain-events.ts` provides `emitRunTerminal` and `subscribeRunTerminal`.
- `lib/integrations/slack/subscriber.ts` registers a `FAIL` listener and calls `notifyRunFailed(runId)`.
- Subscriber registration occurs in both:
  - `src/instrumentation.ts` (web process)
  - `src/workers/runner-maintenance.ts` (maintenance worker process)

The bus is process-local, so each process registers independently.

## Notification Pipeline

`notifyRunFailed` performs:

1. Load run/testCase/project/team Slack settings.
2. Claim row atomically (`slackNotifyClaimedAt`, increment attempts).
3. Render template safely (`&`, `<`, `>` escaped in runtime values).
4. Post via Slack API.
5. Persist outcome:
   - success -> `slackNotifiedAt` set
   - retryable error -> claim cleared, retry later
   - non-retryable error -> mark notified with `slackNotifyError`

Claim TTL (`SLACK_CLAIM_TTL_MS`) allows recovery after process crash.

## Safety Sweep

The maintenance loop runs `runSlackNotificationSweep` on interval:

- `status = FAIL`
- `slackNotifiedAt IS NULL`
- attempts below max
- completed older than 90s and newer than 24h

Sweep calls the same `notifyRunFailed` path, so claim logic deduplicates active path vs sweep path races.

## Error Classification

- Non-retryable: `invalid_auth`, `account_inactive`, `channel_not_found`, `not_in_channel`
- Retryable: `429`, upstream `5xx`, transport timeout/network failures

If attempts exceed `SLACK_SWEEP_MAX_ATTEMPTS`, run is marked notified with terminal Slack error.

## No-Token-Leak Invariant

- Team token is stored encrypted in `Team.slackBotTokenEncrypted`.
- Team/project GET routes never return token or mask.
- Channel/user lookup routes decrypt server-side and only return metadata.

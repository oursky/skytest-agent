# Slack Notification Architecture

## Scope

SkyTest can post Slack messages when a project run reaches terminal status based on project configuration:

- `FAILED_ONLY`: notify only on `FAIL`
- `BOTH_PASSED_AND_FAILED`: notify on both `PASS` and `FAIL`

## Trigger Paths

`runTerminal` events are emitted from all failure writers:

- `lib/runtime/local-browser-runner-lifecycle.ts`
- `lib/runners/event-service.ts`
- `lib/runners/lease-reaper.ts`
- `lib/runners/queue-sanitizer.ts`

## In-Process Bus

- `lib/runners/domain-events.ts` provides `emitRunTerminal` and `subscribeRunTerminal`.
- `lib/integrations/slack/subscriber.ts` registers a terminal listener for `PASS`/`FAIL` and calls `notifyRunTerminal(runId)`.
- Subscriber registration occurs in:
  - `src/instrumentation.ts` (web process)
  - `src/workers/browser-runner.ts` (browser worker process)
  - `src/workers/runner-maintenance.ts` (maintenance worker process)

The bus is process-local, so each process registers independently.

## Delivery Policy

Slack notification behavior uses fixed internal policy values in `lib/integrations/slack/config.ts`:

- max attempts: 5
- claim TTL: 90 seconds

There are no Slack-specific environment variables in runtime configuration.

## Notification Pipeline

`notifyRunTerminal` performs:

1. Load run/testCase/project/team Slack settings.
2. Claim row atomically (`slackNotifyClaimedAt`, increment attempts).
3. Render template safely (`&`, `<`, `>` escaped in runtime values).
4. Post via Slack API.
5. Respect project notify mode:
   - skip `PASS` when mode is `FAILED_ONLY`
   - notify both `PASS`/`FAIL` when mode is `BOTH_PASSED_AND_FAILED`
6. Persist outcome:
   - success -> `slackNotifiedAt` set
   - retryable error -> claim cleared
   - non-retryable error -> mark notified with `slackNotifyError`

Claim TTL (defined in `lib/integrations/slack/config.ts`) allows recovery after process crash.

## Error Classification

- Non-retryable: `invalid_auth`, `account_inactive`, `channel_not_found`, `not_in_channel`
- Retryable: `429`, upstream `5xx`, transport timeout/network failures

If attempts exceed max attempts, run is marked notified with terminal Slack error.

## No-Token-Leak Invariant

- Team token is stored encrypted in `Team.slackBotTokenEncrypted`.
- Team/project GET routes never return token or mask.
- Channel/user lookup routes decrypt server-side and only return metadata.

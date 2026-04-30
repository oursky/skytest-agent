# Slack App Setup

This guide configures Slack notifications for failed runs.

## Prerequisites

- `ENCRYPTION_SECRET` configured for your SkyTest deployment
- `APP_BASE_URL` set to your reachable SkyTest base URL
- `SKYTEST_SLACK_NOTIFICATIONS=true`

Optional tuning:

- `SLACK_SWEEP_INTERVAL_MS` (default `300000`)
- `SLACK_SWEEP_BATCH_SIZE` (default `25`)
- `SLACK_SWEEP_MAX_ATTEMPTS` (default `5`)
- `SLACK_CLAIM_TTL_MS` (default `90000`)
- `SLACK_SWEEP_STABILITY_DELAY_MS` (default `90000`)
- `SLACK_SWEEP_MAX_AGE_MS` (default `86400000`)

## 1) Create Slack App From Manifest

1. Open <https://api.slack.com/apps>.
2. Choose **Create New App** -> **From an app manifest**.
3. Paste [`slack-app-manifest.yml`](./slack-app-manifest.yml).
4. Install the app to your workspace.
5. Copy the **Bot User OAuth Token** (`xoxb-...`).

## 2) Connect Token In SkyTest

1. Open **Team Settings** -> **Integration**.
2. Paste the bot token into **Slack Notifications**.
3. Click **Connect**.
4. Click **Test connection**.

The token is encrypted at rest and never returned by API responses.

## 3) Invite Bot To Notification Channels

For every channel you want to notify:

1. Open channel in Slack.
2. Run `/invite @SkyTest` (or your configured bot name).

If the bot is not invited, sends fail with `not_in_channel`.

## 4) Configure Project Notifications

1. Open **Project** -> **Integration**.
2. Enable **Notify Slack on failed runs**.
3. Select a channel.
4. Customize the template if needed.
5. Send a test message.

Template mentions support Slack user and special mentions such as `<@U123ABC>`, `<@U123ABC|qa-oncall>`, `<!here>`, and `<!subteam^S123ABC>`.

## Token Rotation

To rotate credentials:

1. Generate a new bot token in Slack.
2. Reconnect in **Team Settings** -> **Integration**.
3. Re-test project notification delivery.

## Delivery Semantics

Slack delivery is at-least-once. In timeout scenarios, retries can produce duplicate messages.

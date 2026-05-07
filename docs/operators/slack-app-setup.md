# Slack App Setup

This guide configures Slack notifications for project test runs.

## Prerequisites

- `ENCRYPTION_SECRET` configured for your SkyTest deployment

No Slack-specific environment variables are required. Notifications are active when team token + project settings are configured.

## 1) Create Slack App And Get Bot Token

1. Open <https://api.slack.com/apps>.
2. Go to **Features** -> **OAuth & Permissions**.
3. Add **Bot Token Scopes**: `chat:write`, `channels:read`, `groups:read`, and `users:read`.
4. In **OAuth Tokens** section, install the app to your workspace.
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
2. Enable Slack notifications.
3. Choose notification scope:
   - **Notify for Failed test runs only**
   - **Notify for both Passed and Failed test runs**
4. Select a channel.
5. Customize failed/passed message templates as needed.
6. Send a test message.

## Token Rotation

To rotate credentials:

1. Generate a new bot token in Slack.
2. Reconnect in **Team Settings** -> **Integration**.
3. Re-test project notification delivery.

## Delivery Semantics

Slack delivery is at-least-once. In timeout scenarios, retries can produce duplicate messages.

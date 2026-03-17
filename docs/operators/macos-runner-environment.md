# macOS Runner Environment

This guide describes how `skytest start runner` resolves runner environment values for source and Homebrew installs.

## What The CLI Injects

When the CLI starts a paired runner, it injects the runner identity and transport values automatically:

- `RUNNER_TOKEN`
- `RUNNER_CONTROL_PLANE_URL`
- `RUNNER_LABEL`
- `RUNNER_VERSION`
- `RUNNER_DISPLAY_ID`
- `RUNNER_HOST_FINGERPRINT`
- `SKYTEST_RUNNER_STATE_DIR`
- `SKYTEST_RUNNER_DISABLE_KEYCHAIN`
- `SKYTEST_RUNNER_QUIET`

You do not need to manage those values by hand in normal workflows.

## What You May Override

The runner reads optional Midscene overrides from the environment:

- `SKYTEST_MIDSCENE_MODEL_BASE_URL`
- `SKYTEST_MIDSCENE_MODEL_NAME`
- `SKYTEST_MIDSCENE_MODEL_FAMILY`
- `SKYTEST_MIDSCENE_PLANNING_MODEL_BASE_URL`
- `SKYTEST_MIDSCENE_PLANNING_MODEL_NAME`
- `SKYTEST_MIDSCENE_PLANNING_MODEL_FAMILY`
- `SKYTEST_MIDSCENE_INSIGHT_MODEL_BASE_URL`
- `SKYTEST_MIDSCENE_INSIGHT_MODEL_NAME`
- `SKYTEST_MIDSCENE_INSIGHT_MODEL_FAMILY`
- `SKYTEST_MIDSCENE_MODEL_TEMPERATURE`

The CLI supports an optional repair pairing token for automatic `401` recovery on start:

- `SKYTEST_REPAIR_PAIRING_TOKEN`

The runner does not require `DATABASE_URL`.

## Resolution Order

When `skytest start runner <runner-id>` launches the process, values are resolved in this order:

1. built-in Midscene defaults
2. env files, if present, in this order:
   - `SKYTEST_RUNNER_ENV_FILE`
   - `~/.config/skytest/runner.env`
   - `<repo>/.env`
   - `<repo>/.env.local`
   - `<repo>/.env.<NODE_ENV>`
   - `<repo>/.env.<NODE_ENV>.local`
3. shell environment at command execution time

## Startup Repair Behavior

`skytest start runner <runner-id>` now supports automatic recovery paths:

- `409 host fingerprint mismatch`: runner host binding is repaired automatically.
- `401 unauthorized`:
  - if `--repair-token` is provided, the runner is re-paired in place and started.
  - else if `SKYTEST_REPAIR_PAIRING_TOKEN` is set, that token is used.
  - otherwise the stale local runner entry is removed and start returns a re-pair instruction.

Example with explicit repair token:

```bash
skytest start runner <runner-id> --repair-token "<pairing-token>"
```

## Source Install

If you start `skytest` from this repository, `<repo>/.env.local` is a convenient place for optional overrides:

```env
SKYTEST_MIDSCENE_MODEL_NAME=bytedance-seed/seed-1.6-flash
SKYTEST_MIDSCENE_MODEL_TEMPERATURE=0.2
```

## Homebrew Install

For Homebrew-managed runners, prefer `~/.config/skytest/runner.env`:

```env
SKYTEST_MIDSCENE_MODEL_NAME=bytedance-seed/seed-1.6-flash
SKYTEST_MIDSCENE_MODEL_TEMPERATURE=0.2
```

Use a different file path only when you need it explicitly:

```bash
SKYTEST_RUNNER_ENV_FILE=/path/to/runner.env skytest start runner <runner-id>
```

## Reset

Source install:

```bash
npm run skytest -- unpair runner <runner-id>
npm run skytest -- reset --force
```

Homebrew install:

```bash
skytest unpair runner <runner-id>
skytest reset --force
```

`<runner-id>` can be the local 6-character runner ID, the full runner ID shown in `Team Settings -> Runners`, or a unique prefix of either.

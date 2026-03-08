# CLI Runner Environment Configuration

This guide explains how runner configuration is resolved for source development and Homebrew users.

## What The Runner Needs

Required:

- `DATABASE_URL`

Provided automatically by `skytest` CLI when a runner is paired/started:

- `RUNNER_TOKEN`
- `RUNNER_CONTROL_PLANE_URL`
- `RUNNER_LABEL`
- `RUNNER_VERSION`
- `SKYTEST_RUNNER_STATE_DIR`

Model behavior for Midscene:

- SkyTest now applies fixed built-in defaults for model name/family/base URL and temperature.
- You can still override these values explicitly when needed.

## Resolution Order

When `skytest start runner ...` launches the process, env values are resolved in this order:

1. SkyTest built-in Midscene defaults
2. Env files (if present), in order:
   - `SKYTEST_RUNNER_ENV_FILE` (custom explicit file path)
   - `~/.config/skytest/runner.env`
   - `<repo>/.env`
   - `<repo>/.env.local`
   - `<repo>/.env.<NODE_ENV>`
   - `<repo>/.env.<NODE_ENV>.local`
3. Shell environment at command execution time (highest precedence)

## Local Development (From Source)

Use `<repo>/.env.local` for local development. The `skytest` command started from the repo will load it.

Typical minimum:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/skytest_agent?schema=public
```

Optional model overrides for local experiments:

```env
SKYTEST_MIDSCENE_MODEL_NAME=bytedance-seed/seed-1.6-flash
SKYTEST_MIDSCENE_MODEL_TEMPERATURE=0.2
```

## Homebrew Users

Recommended: put runner env in `~/.config/skytest/runner.env`.

Example:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/skytest_agent?schema=public
SKYTEST_MIDSCENE_MODEL_NAME=bytedance-seed/seed-1.6-flash
SKYTEST_MIDSCENE_MODEL_TEMPERATURE=0.2
```

Then run:

```bash
skytest pair runner "<pairing-token>" --control-plane-url "http://127.0.0.1:3000"
```

If you want a different config path:

```bash
SKYTEST_RUNNER_ENV_FILE=/path/to/runner.env skytest start runner <local-runner-id>
```

## Cleanup / Reset

Source:

```bash
npm run skytest -- unpair runner <local-runner-id>
npm run skytest -- reset --force
```

Homebrew:

```bash
skytest unpair runner <local-runner-id>
skytest reset --force
```

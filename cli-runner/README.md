# macOS Runner

Headless runner agent for Android execution in Phase 3.
This runtime is managed by the `skytest` CLI and is not started directly in normal workflows.

## Environment Variables

- `RUNNER_CONTROL_PLANE_URL` (default `http://127.0.0.1:3000`)
- `RUNNER_LABEL` (default `macOS Runner`)
- `RUNNER_VERSION` (default `0.1.0`)
- `RUNNER_TOKEN` (optional existing runner credential)
- `RUNNER_PAIRING_TOKEN` (required when no stored credential exists)

## Start

```bash
npm run skytest -- pair runner "<pairing-token>" --control-plane-url "http://127.0.0.1:3000"
```

Use `npm run skytest -- get runners` and `npm run skytest -- start runner <local-runner-id>`
for lifecycle operations.

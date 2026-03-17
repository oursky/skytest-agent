# macOS Runner

Headless runner agent for Android execution.
This runtime is managed by the `skytest` CLI and is not started directly in normal workflows.

Operator docs live in:

- `docs/operators/macos-android-runner-guide.md`
- `docs/operators/macos-runner-environment.md`

## Environment Variables

The CLI injects runner identity values automatically when it starts a paired runner:

- `RUNNER_CONTROL_PLANE_URL`
- `RUNNER_LABEL`
- `RUNNER_VERSION`
- `RUNNER_TOKEN`

Optional model overrides are documented in `docs/operators/macos-runner-environment.md`.

## Start

```bash
npm run skytest -- pair runner "<pairing-token>" --url "http://127.0.0.1:3000"
```

Use `npm run skytest -- get runners` and `npm run skytest -- start runner <runner-id>`
for lifecycle operations. `<runner-id>` can be the local 6-character runner ID or the runner ID shown in `Team Settings -> Runners`.

If startup returns `401`, you can recover in one step with:

```bash
npm run skytest -- start runner <runner-id> --repair-token "<pairing-token>"
```

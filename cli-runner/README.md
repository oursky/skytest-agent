# macOS Runner

Headless runner agent for Android execution in Phase 3.

## Environment Variables

- `RUNNER_CONTROL_PLANE_URL` (default `http://127.0.0.1:3000`)
- `RUNNER_LABEL` (default `macOS Runner`)
- `RUNNER_VERSION` (default `0.1.0`)
- `RUNNER_TOKEN` (optional existing runner credential)
- `RUNNER_PAIRING_TOKEN` (required when no stored credential exists)

## Start

```bash
npm run runner:macos
```

On first boot, pass `RUNNER_PAIRING_TOKEN` to exchange for a durable credential.
The credential is saved in macOS Keychain when available and also in
`~/.skytest-agent/runner-credential.json`.

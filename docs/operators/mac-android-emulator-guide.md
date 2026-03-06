# macOS Android Runner Setup Guide

This guide is for local developers and self-hosting operators who run Android tests on macOS in Phase 3.

Architecture reminder:

- Web app (`npm run dev`) is the control plane only.
- Android execution happens in the macOS runner process (`npm run runner:macos`).
- Manual app installation on devices is required. No auto-install flow is provided.

Related docs:

- [`docs/operators/local-dev.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/local-dev.md)
- [`docs/operators/android-runtime-deployment-checklist.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/android-runtime-deployment-checklist.md)
- [`docs/maintainers/android-runtime-maintenance.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/android-runtime-maintenance.md)

## 1. Prerequisites

- macOS host
- Xcode Command Line Tools
- Node.js + npm
- JDK 17+
- Android Studio (recommended) or Android SDK CLI tools
- Running local control plane (`npm run dev`) with Postgres + MinIO

Install command line tools:

```bash
xcode-select --install
```

## 2. Android SDK Setup

Install Android components:

- Android SDK Platform-Tools
- Android Emulator
- Android SDK Command-line Tools (latest)
- At least one system image (Apple Silicon example: `system-images;android-34;google_apis;arm64-v8a`)

Add to `~/.zshrc`:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Reload shell and verify:

```bash
source ~/.zshrc
which adb
which emulator
which avdmanager
adb version
emulator -version
emulator -list-avds
```

## 3. Start Local Control Plane

Follow [`docs/operators/local-dev.md`](./local-dev.md) first:

```bash
npm run dev:services:up
npm install
npm run db:generate
npx prisma db push
npm run dev
```

## 4. Create Runner Pairing Token

The runner needs a short-lived pairing token on first boot.

1. Open `Team Settings -> Runners`.
2. Click `Add Runner` (owner/admin team role required).
3. Copy the one-time pairing token shown in the dialog.

API fallback for automation only:

```bash
curl -sS -X POST "http://127.0.0.1:3000/api/teams/<team-id>/runner-pairing" \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"ttlMinutes":10}'
```

## 5. Start macOS Runner

First boot (with pairing token):

```bash
RUNNER_CONTROL_PLANE_URL="http://127.0.0.1:3000" \
RUNNER_LABEL="Local macOS Runner" \
RUNNER_PAIRING_TOKEN="<pairing-token>" \
npm run runner:macos
```

After successful pairing, restart without `RUNNER_PAIRING_TOKEN`:

```bash
RUNNER_CONTROL_PLANE_URL="http://127.0.0.1:3000" \
RUNNER_LABEL="Local macOS Runner" \
npm run runner:macos
```

Credential storage:

- macOS Keychain (when available)
- `~/.skytest-agent/runner-credential.json` (metadata/fallback)

## 6. Device Preparation Rules

- Install your Android app manually before running tests.
- Keep USB debugging enabled for physical devices.
- For emulators, make sure target AVDs exist and can boot.

Useful checks:

```bash
adb devices -l
emulator -list-avds
```

## 7. Validate End-to-End

1. Open web app and go to `Team Settings -> Runners`.
2. Confirm runner is connected and device rows are visible.
3. Start an Android test run from the run page and select an available device.
4. Confirm run status/events update and screenshots appear in results.

## 8. Troubleshooting

### `Invalid pairing token` or `401` on runner startup

- Pairing token expired (default 10 minutes); generate a new one.
- Confirm `RUNNER_CONTROL_PLANE_URL` points to the running control plane.

### Runner connected but no devices shown

- Check Android SDK binaries are in PATH for the runner process.
- Run `adb devices -l` and verify at least one device is in `device` state.
- Ensure emulator/device is online and not unauthorized/offline.

### Selected device cannot run

- Device may have become stale/disconnected between selection and claim.
- Refresh `Team Settings -> Runners`, re-check availability, and rerun.

### Need to reset local runner credential

Delete fallback file and re-pair:

```bash
rm -f ~/.skytest-agent/runner-credential.json
```

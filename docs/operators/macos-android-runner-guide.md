# macOS Android Runner Guide

This guide covers the macOS host that provides Android execution capacity to SkyTest.

Architecture summary:

- the control plane runs locally or in Kubernetes
- browser runs execute in the control-plane process
- Android runs execute on external macOS runners managed by `skytest`
- app installation on devices is manual

Related docs:

- [local development](./local-development.md)
- [macOS runner environment](./macos-runner-environment.md)
- [Android runtime deployment checklist](./android-runtime-deployment-checklist.md)
- [Android runtime maintenance](../maintainers/android-runtime-maintenance.md)

## 1. Prepare The Control Plane URL

Pick the URL the runner should call:

- local development: `http://127.0.0.1:3000`
- shared deployment: your cluster ingress or load balancer URL

If you are running locally, start the control plane first:

```bash
make dev
```

Keep that process running in one terminal and use another terminal for runner setup.

## 2. Prepare The macOS Host

Install these prerequisites on the macOS host:

- Xcode Command Line Tools
- Node.js and npm, or the Homebrew `skytest` package
- JDK 17 or newer
- Android Studio or Android SDK command-line tools

Install the Xcode tools if needed:

```bash
xcode-select --install
```

Install Android components:

- Android SDK Platform-Tools
- Android Emulator
- Android SDK Command-line Tools
- at least one Android system image that matches the emulator profiles you plan to run

Add SDK binaries to the shell environment:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Reload the shell and verify the tools:

```bash
source ~/.zshrc
which adb
which emulator
which avdmanager
adb version
emulator -version
emulator -list-avds
```

## 3. Create A Pairing Token

1. Open `Team Settings -> Runners`.
2. Click `Add Runner`.
3. Copy the pairing token from the dialog.

## 4. Pair And Manage The Runner

From source:

```bash
npm run skytest -- pair runner "<pairing-token>" \
  --url "<control-plane-url>" \
  --label "macOS Android Runner"
```

The pair command creates the local runner definition and starts the process immediately.

Lifecycle commands:

```bash
npm run skytest -- get runners
npm run skytest -- start runner <runner-id>
npm run skytest -- stop runner <runner-id>
npm run skytest -- logs runner <runner-id> --tail 200
npm run skytest -- unpair runner <runner-id>
```

`<runner-id>` can be the local 6-character runner ID, the full runner ID shown in `Team Settings -> Runners`, or a unique prefix of either.

For Homebrew installs, run the same commands directly with `skytest ...`.

## 5. Prepare Devices

- install the Android app manually before running tests
- keep USB debugging enabled for physical devices
- make sure emulator profiles already exist and can boot

Useful checks:

```bash
adb devices -l
emulator -list-avds
```

## 6. Validate End To End

1. Open `Team Settings -> Runners`.
2. Confirm the runner is connected and devices are listed.
3. Start an Android test run and choose an available device.
4. Confirm the run updates, screenshots, and final result appear in the web UI.

## 7. Troubleshooting

### Invalid pairing token or `401` on runner startup

- generate a fresh pairing token
- confirm the control-plane URL is correct and reachable from the macOS host

If the runner was unpaired in the web UI, the local CLI entry is cleaned up after the next unauthorized runner request.

### Runner connected but no devices shown

- confirm `adb`, `emulator`, and `avdmanager` are in the runner process PATH
- run `adb devices -l` and verify at least one device is in `device` state
- ensure the emulator or device is not `offline` or `unauthorized`

### AI step fails with model configuration errors

- restart the runner so the latest environment is loaded
- review [macOS runner environment](./macos-runner-environment.md)

### Selected device cannot run

- the device may have disappeared between selection and claim
- refresh `Team Settings -> Runners`, confirm availability, and retry the run

### Need to remove local runner state

From source:

```bash
npm run skytest -- reset --force
```

From Homebrew:

```bash
skytest reset --force
brew uninstall skytest
rm -rf "$(brew --prefix)/var/skytest"
```

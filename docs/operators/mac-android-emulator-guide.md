# macOS Android Devices Guide (Operator / Self-Hosting)

This guide is for people who clone this repository and want to run this app with Android testing on macOS.

It covers emulator profiles (AVDs) and connected Android devices.

It covers:

- host setup
- Android SDK / emulator prerequisites
- creating emulator profiles (AVDs)
- connected physical device basics (optional)
- day-to-day operations
- troubleshooting

Related docs:

- [`docs/operators/android-runtime-deployment-checklist.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/android-runtime-deployment-checklist.md)
- [`docs/maintainers/android-runtime-maintenance.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/android-runtime-maintenance.md) (runtime behavior and limitations)

## 1. Host Setup

### Prerequisites

- macOS host
- Xcode Command Line Tools
- Node.js + npm
- Java runtime (JDK 17+ recommended)
- Android Studio (recommended) or Android SDK CLI tools

Install command line tools:

```bash
xcode-select --install
```

Install Node.js (example with `nvm`):

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install --lts
nvm use --lts
```

Install Android Studio, then use SDK Manager to install required Android components.

### Android SDK Components to Install

In Android Studio -> Settings -> Android SDK, install:

- Android SDK Platform-Tools
- Android Emulator
- Android SDK Command-line Tools (latest)
- At least one system image

Apple Silicon example image:

- `system-images;android-34;google_apis;arm64-v8a`

### Environment Variables

Add to `~/.zshrc`:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Reload shell:

```bash
source ~/.zshrc
```

Verify:

```bash
which adb
which emulator
which avdmanager
adb version
emulator -version
emulator -list-avds
```

## 2. Create Emulator Profiles (AVDs)

The UI uses the term "Emulators" for the emulator-profile section, but under the hood Android SDK still calls them AVDs.

The app stores the emulator profile (AVD) name and boots by that name.

Examples:

- `Pixel_7_API_34`
- `Pixel_8_API_35`

### Option A: Android Studio UI (Recommended)

1. Open Android Studio -> Device Manager
2. Create a new virtual device
3. Choose hardware profile (for example Pixel 7)
4. Choose system image
5. Finish and note the emulator template / AVD name

### Option B: CLI

List available device definitions:

```bash
avdmanager list device
```

Install a system image (example):

```bash
sdkmanager "system-images;android-34;google_apis;arm64-v8a"
```

Create emulator profile:

```bash
avdmanager create avd -n Pixel_7_API_34 -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_7
```

Verify:

```bash
emulator -list-avds
```

## 3. Manual Emulator Operations (Useful for Debugging)

Boot with window:

```bash
emulator -avd Pixel_7_API_34 -port 5554
```

Launch headless from CLI (debugging only):

```bash
emulator -avd Pixel_7_API_34 -port 5554 -no-window -no-audio -no-boot-anim
```

List running emulator devices:

```bash
adb devices
```

Stop emulator:

```bash
adb -s emulator-5554 emu kill
```

## 4. Optional: Connected Physical Devices (USB)

The Android runtime can also run tests on connected physical devices.

Checklist:

- Enable Developer Options on the Android device
- Enable USB debugging
- Authorize the host when prompted
- Confirm the device appears in:

```bash
adb devices -l
```

Notes:

- Physical devices appear in the project `Devices` tab under `Physical Devices`
- The app can use a connected physical device as an Android target
- The app does not support stopping connected physical devices from the UI/API

## 5. Android Runtime Behavior (Operator View)

### Device Controls in UI

In Project -> Devices:

- Emulators section shows available emulator profiles (AVDs) and running emulator runtime devices
- Physical Devices section shows connected Android devices detected via ADB
- If an emulator profile is not running: `Boot (window)`
- If an app-managed emulator is running: `Stop`
- Connected emulators started outside the app may also appear and can be stopped from the UI when ADB reports them as ready

### What Test Runs Do

- Android test runs can target either:
  - an emulator profile (AVD), or
  - a connected physical device (by serial)
- Emulator-profile runs acquire a matching emulator from the pool or boot one
- Emulator-profile runs execute on headless emulators
- After an emulator-profile run, the emulator is usually **released back to the pool** (may remain running as `IDLE`)
- Connected physical devices are leased by serial and returned to `IDLE` after cleanup (not stopped by the app)
- The app under test may or may not have data cleared depending on the `Clear App Data` toggle

Important:

- Do not assume every run fully stops an emulator
- Do not assume every run fully wipes device state

See [`docs/maintainers/android-runtime-maintenance.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/android-runtime-maintenance.md) for exact cleanup/isolation behavior.

### Runtime Device Status Meanings

- `STARTING`: emulator process launch started
- `BOOTING`: waiting for Android boot completion
- `IDLE`: ready and not assigned to a run
- `ACQUIRED` (UI may show "In Use"): assigned to a test run
- `CLEANING`: post-run cleanup in progress
- `STOPPING`: shutdown in progress
- `DEAD`: no active instance (typically not shown as active)

Inventory-only connected devices may instead show ADB availability states (for example `Connected`, `Unauthorized`, `Offline`) when they are not attached to the app runtime.

## 6. Troubleshooting

### `adb` / `emulator` command not found

- Re-check `ANDROID_HOME` / `ANDROID_SDK_ROOT`
- Re-check PATH exports and reload shell
- Confirm binaries exist under `$HOME/Library/Android/sdk`

### Emulator boot hangs

Check boot completion:

```bash
adb -s emulator-5554 shell getprop sys.boot_completed
```

Expected output: `1`

If still hanging:

```bash
adb kill-server
adb start-server
adb -s emulator-5554 emu kill
```

Then boot again.

### Emulator visible in `adb devices` but not controllable in the UI

- Re-open the project `Devices` tab and refresh/wait for polling (15s)
- If it is an unmanaged emulator (for example started by Android Studio/manual CLI), it may appear under emulator inventory and can usually be stopped by serial
- If it still is not app-controllable, stop it manually:

```bash
adb -s emulator-5554 emu kill
```

### Physical device shows `Unauthorized` or `Offline`

- Check the device screen for the USB debugging authorization prompt
- Reconnect USB and run:

```bash
adb kill-server
adb start-server
adb devices -l
```

- Confirm the device appears with state `device` before using it in a test run

### Emulator process stuck

Find process and terminate:

```bash
ps aux | rg "emulator|qemu-system"
kill -TERM <PID>
```

### Need deeper logs

ADB logs:

```bash
adb -s emulator-5554 logcat
```

Manual emulator verbose run:

```bash
emulator -avd Pixel_7_API_34 -port 5554 -verbose
```

## 7. Quick Validation Checklist (Fresh Mac)

1. `emulator -list-avds` returns at least one emulator profile (AVD)
2. Boot one emulator manually and confirm `adb devices` shows it
3. Open project Devices tab and verify the emulator profile appears and can be booted
4. Boot and stop an app-managed emulator from the UI
5. (Optional) Connect a physical Android device and verify it appears under Physical Devices with state `Connected`
6. Run one Android test and verify the selected device becomes `In Use` and then returns to `IDLE` (or stops for some emulator flows)

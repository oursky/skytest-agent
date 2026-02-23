# macOS Android Emulator Guide (Operator / Self-Hosting)

This guide is for people who clone this repository and want to run this app with Android testing on macOS.

It covers:

- host setup
- Android SDK / emulator prerequisites
- creating emulator templates (AVDs)
- day-to-day operations
- troubleshooting

Related docs:

- `docs/operators/android-runtime-deployment-checklist.md`
- `docs/maintainers/android-runtime-maintenance.md` (runtime behavior and limitations)

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

## 2. Create Emulator Templates (AVDs)

The UI uses the term "Emulators" for user-facing clarity, but under the hood Android SDK still calls them AVDs.

The app stores the emulator template name and boots by that name.

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

Create emulator template:

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

## 4. Android Runtime Behavior (Operator View)

### Emulator Controls in UI

In Project -> Emulators:

- If an emulator template is not running: `Boot (window)`
- If an app-managed emulator is running: `Stop`

### What Test Runs Do

- Android test runs acquire a matching emulator from the pool or boot one
- Test runs execute on headless emulators
- After a run, the emulator is usually **released back to the pool** (may remain running as `IDLE`)
- The app under test may or may not have data cleared depending on the `Clear App Data` toggle

Important:

- Do not assume every run fully stops the emulator
- Do not assume every run fully wipes emulator state

See `docs/maintainers/android-runtime-maintenance.md` for exact cleanup/isolation behavior.

### Emulator Status Meanings

- `STARTING`: emulator process launch started
- `BOOTING`: waiting for Android boot completion
- `IDLE`: ready and not assigned to a run
- `ACQUIRED` (UI may show "In Use"): assigned to a test run
- `CLEANING`: post-run cleanup in progress
- `STOPPING`: shutdown in progress
- `DEAD`: no active instance (typically not shown as active)

## 5. Troubleshooting

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

- It may be an unmanaged emulator (for example started by Android Studio/manual CLI)
- User APIs only control app-managed emulators
- Stop it manually:

```bash
adb -s emulator-5554 emu kill
```

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

## 6. Quick Validation Checklist (Fresh Mac)

1. `emulator -list-avds` returns at least one emulator template
2. Boot one emulator manually and confirm `adb devices` shows it
3. Open project Emulators tab and verify the template appears and can be booted
4. Boot and stop an app-managed emulator from the UI
5. Run one Android test and verify emulator status becomes `In Use` and then returns to `IDLE` or stops

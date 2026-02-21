# Mac Android Emulator Guide

This guide covers setup, operations, and troubleshooting for running SkyTest Agent on macOS with Android emulator support.

---

## Part 1: Setup

### 1.1 Prerequisites

- Xcode Command Line Tools
- Node.js + npm
- Android SDK tools (`adb`, `emulator`, `avdmanager`)
- Java runtime (JDK 17+ recommended)

```bash
xcode-select --install
```

Install Node.js (example with nvm):
```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install --lts
nvm use --lts
```

Install Android Studio (recommended) and then install SDK components from SDK Manager.

### 1.2 Android SDK Components

Open Android Studio -> Settings -> Android SDK and install:
- Android SDK Platform-Tools
- Android Emulator
- Android SDK Command-line Tools (latest)
- At least one system image (Apple Silicon: `arm64-v8a` image)

Example image for recent Android:
- `system-images;android-34;google_apis;arm64-v8a`

### 1.3 Environment Variables

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
avdmanager list avd
```

### 1.4 Create AVD Profiles

An AVD profile is a named virtual Android device definition (device model + API level + system image). SkyTest uses AVD names to boot emulators.

Examples: `Pixel_7_API_34`, `Pixel_8_API_35`

#### Option A: Android Studio UI
1. Open Device Manager.
2. Create device.
3. Select hardware profile (e.g. Pixel 7).
4. Select system image.
5. Finish and note the AVD name.

#### Option B: CLI
List devices:
```bash
avdmanager list device
```

Install system image (example):
```bash
sdkmanager "system-images;android-34;google_apis;arm64-v8a"
```

Create AVD:
```bash
avdmanager create avd -n Pixel_7_API_34 -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_7
```

List AVDs:
```bash
emulator -list-avds
```

---

## Part 2: Operations

### 2.1 Manual Emulator Control

Boot with window:
```bash
emulator -avd Pixel_7_API_34 -port 5554
```

Boot headless:
```bash
emulator -avd Pixel_7_API_34 -port 5554 -no-window -no-audio -no-boot-anim
```

Check connected emulators:
```bash
adb devices
```

Stop emulator:
```bash
adb -s emulator-5554 emu kill
```

### 2.2 SkyTest Emulator Pool

In Project -> Emulators tab:
- If profile is not running: `Boot (window)` and `Boot (headless)` buttons are shown.
- If emulator is running in any state: `Stop` is shown.

Test-run behavior:
- Test runs always acquire or boot headless emulators.
- After test run cleanup, the emulator is stopped.

### 2.3 Emulator Status Meanings

Pool states shown by UI:
- `STARTING`: process creation started
- `BOOTING`: waiting for Android boot completion
- `IDLE`: ready and not assigned to a run
- `ACQUIRED` (shown as "In Use"): assigned to a test run
- `CLEANING`: internal cleanup state
- `STOPPING`: shutdown in progress
- `DEAD` (shown as "Stopped"): no active instance

---

## Part 3: Troubleshooting

### `adb` / `emulator` command not found
- Re-check `ANDROID_HOME` / `ANDROID_SDK_ROOT`.
- Re-check PATH export and `source ~/.zshrc`.
- Confirm files exist under `$HOME/Library/Android/sdk`.

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

### Emulator visible in `adb devices` but not controllable in app
- It may be an unmanaged runtime instance.
- Use app `Stop` first; if needed force kill manually:
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

Run emulator with verbose logging (manual run):
```bash
emulator -avd Pixel_7_API_34 -port 5554 -verbose
```

---

## Onboarding Verification Checklist

On a clean Mac, verify this exact sequence works:
1. `emulator -list-avds` returns at least one profile.
2. Boot one emulator manually and confirm `adb devices` shows it.
3. Open project Emulators tab and verify status appears.
4. Stop emulator from UI and confirm it disappears from `adb devices`.
5. Run one Android test case and confirm emulator status goes to `In Use` and then stops after run completion.

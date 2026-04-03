import { AndroidAgent, AndroidDevice } from '@/types';
import { config } from '@/config/app';
import { ConfigurationError, getErrorMessage } from '@/lib/core/errors';
import { type AndroidDeviceLease } from '@/lib/android/device-manager';
import { ReliableAdb } from '@/lib/android/adb-reliable';
import { resolveAndroidToolPath } from '@/lib/android/sdk';

export type AndroidRuntimeLogger = (
    message: string,
    level?: 'info' | 'error' | 'success',
    browserId?: string
) => void;

const ANDROID_AGENT_OPERATION_TIMEOUT_MS = 120_000;
const ANDROID_ADB_RECOVERY_TIMEOUT_MS = 20_000;
const ANDROID_ADB_RECOVERY_ATTEMPTS = 2;
const ANDROID_WAKE_UNLOCK_COMMAND_TIMEOUT_MS = config.emulator.adb.commandTimeoutMs;
const androidAdbPath = resolveAndroidToolPath('adb');

function isValidAndroidPackageName(appId: string): boolean {
    return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(appId);
}

export function assertValidAndroidPackageName(appId: string, targetLabel: string): void {
    if (!isValidAndroidPackageName(appId)) {
        throw new ConfigurationError(`Android target "${targetLabel}" has invalid app ID "${appId}"`, 'android');
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.message === 'Aborted';
}

async function withSignalAndTimeout<T>(
    promise: Promise<T>,
    options: {
        signal?: AbortSignal;
        timeoutMs: number;
        timeoutMessage: string;
    }
): Promise<T> {
    const { signal, timeoutMs, timeoutMessage } = options;

    if (signal?.aborted) {
        throw new Error('Aborted');
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;

    try {
        const racers: Promise<T>[] = [promise];

        racers.push(new Promise<T>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(timeoutMessage));
            }, timeoutMs);
        }));

        if (signal) {
            racers.push(new Promise<T>((_, reject) => {
                abortHandler = () => reject(new Error('Aborted'));
                signal.addEventListener('abort', abortHandler, { once: true });
            }));
        }

        return await Promise.race(racers);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler);
        }
    }
}

export async function runAndroidAgentOperation<T>(
    operation: () => Promise<T>,
    operationLabel: string,
    signal?: AbortSignal,
    timeoutMs = ANDROID_AGENT_OPERATION_TIMEOUT_MS
): Promise<T> {
    try {
        return await withSignalAndTimeout(operation(), {
            signal,
            timeoutMs,
            timeoutMessage: `Android ${operationLabel} timed out after ${Math.ceil(timeoutMs / 1000)}s. The device may have disconnected.`,
        });
    } catch (error) {
        if (isAbortError(error)) {
            throw error;
        }
        throw error;
    }
}

export function shouldRetryAndroidActionAfterLoadWait(errorMessage: string): boolean {
    return /splash screen|still on the splash|loading screen|still loading|not found on the current screen/i.test(errorMessage);
}

export function isRecoverableAndroidAdbConnectionError(errorMessage: string): boolean {
    return /device offline|device not found|no devices\/emulators found|connection reset|broken pipe|transport is closing|closed|cannot access system service|can't find service|cannot find service/i.test(errorMessage);
}

export async function recoverAndroidDeviceConnection(
    handle: AndroidDeviceLease,
    targetLabel: string,
    log: AndroidRuntimeLogger,
    targetId: string,
    appId: string | undefined,
    signal?: AbortSignal
): Promise<boolean> {
    const adb = new ReliableAdb(handle.serial, androidAdbPath);

    for (let attempt = 1; attempt <= ANDROID_ADB_RECOVERY_ATTEMPTS; attempt += 1) {
        if (signal?.aborted) {
            throw new Error('Aborted');
        }

        log(
            `[${targetLabel}] Device connection dropped (ADB offline). Attempting recovery ${attempt}/${ANDROID_ADB_RECOVERY_ATTEMPTS}...`,
            'info',
            targetId
        );

        const reconnected = await withSignalAndTimeout(adb.reconnect(), {
            signal,
            timeoutMs: ANDROID_ADB_RECOVERY_TIMEOUT_MS,
            timeoutMessage: `ADB reconnect timed out for ${handle.serial}`,
        }).catch(() => false);

        if (!reconnected) {
            await sleep(config.test.android.recoveryRetryDelayMs);
            continue;
        }

        const device = handle.device;
        if (!device) {
            return true;
        }

        await wakeAndUnlockAndroidDevice(device, signal).catch(() => {});

        if (appId) {
            await forceStopAndroidApp(device, appId).catch(() => {});
            await launchAndroidAppWithLauncherIntent(device, appId).catch(() => false);
            await waitForAndroidAppForeground(device, appId, config.test.android.recoveryForegroundTimeoutMs).catch(() => false);
        }

        try {
            await device.shell('echo skytest-adb-check');
            log(`[${targetLabel}] Device connection recovered.`, 'info', targetId);
            return true;
        } catch (error) {
            log(
                `[${targetLabel}] Recovery validation failed: ${getErrorMessage(error)}`,
                'error',
                targetId
            );
            await sleep(config.test.android.recoveryRetryDelayMs);
        }
    }

    return false;
}

export async function waitForAndroidUiReadyForAction(
    agent: AndroidAgent,
    stepAction: string,
    log: AndroidRuntimeLogger,
    targetLabel: string,
    targetId: string,
    signal?: AbortSignal
): Promise<void> {
    const timeoutMs = Math.max(15_000, config.test.android.postLaunchStabilizationMs * 3);
    log(`[${targetLabel}] Waiting for app UI to finish loading before retrying...`, 'info', targetId);
    await runAndroidAgentOperation(
        () => agent.aiWaitFor(
            `The app is no longer on a splash or loading screen and is ready for this action: ${stepAction}`,
            { timeoutMs, checkIntervalMs: config.test.android.uiReadyCheckIntervalMs }
        ),
        'wait for UI readiness',
        signal,
        timeoutMs + 5_000
    );
}

async function isAndroidAppInForeground(
    device: { shell(command: string): Promise<string> },
    appId: string
): Promise<boolean> {
    try {
        const activityDump = await device.shell('dumpsys activity activities');
        const lowerDump = activityDump.toLowerCase();
        return lowerDump.includes(`${appId.toLowerCase()}/`);
    } catch {
        return false;
    }
}

export async function waitForAndroidAppForeground(
    device: { shell(command: string): Promise<string> },
    appId: string,
    timeoutMs: number
): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await isAndroidAppInForeground(device, appId)) {
            return true;
        }
        await sleep(config.test.android.wakeUnlockStabilizationMs);
    }
    return false;
}

export async function wakeAndUnlockAndroidDevice(device: AndroidDevice, signal?: AbortSignal): Promise<void> {
    const runBestEffortShellCommand = async (command: string) => {
        await withSignalAndTimeout(device.shell(command), {
            signal,
            timeoutMs: ANDROID_WAKE_UNLOCK_COMMAND_TIMEOUT_MS,
            timeoutMessage: `Android wake/unlock command timed out: ${command}`,
        }).catch(() => {});
    };

    await runBestEffortShellCommand('input keyevent KEYCODE_WAKEUP');
    await runBestEffortShellCommand('wm dismiss-keyguard');
    await runBestEffortShellCommand('input keyevent 82');
}

export async function launchAndroidAppWithLauncherIntent(device: AndroidDevice, appId: string): Promise<boolean> {
    const launchOutput = await device.shell(
        `monkey -p ${appId} -c android.intent.category.LAUNCHER 1`
    );
    return !/no activities found|monkey aborted|error/i.test(launchOutput);
}

export async function isAndroidPackageInstalled(device: AndroidDevice, appId: string): Promise<boolean> {
    const installedPackageOutput = await device.shell(`pm list packages ${appId}`);
    return installedPackageOutput
        .split('\n')
        .some((line) => line.trim() === `package:${appId}`);
}

export async function forceStopAndroidApp(device: AndroidDevice, appId: string): Promise<void> {
    await device.shell(`am force-stop ${appId}`);
}

export async function clearAndroidAppData(device: AndroidDevice, appId: string): Promise<boolean> {
    const clearOutput = await device.shell(`pm clear ${appId}`);
    return clearOutput.toLowerCase().includes('success');
}

function extractAndroidPermissionsFromDumpsys(packageDump: string): string[] {
    const permissions = new Set<string>();

    for (const match of packageDump.matchAll(/^\s*([A-Za-z0-9_.]+):\s+granted=(?:true|false)/gm)) {
        permissions.add(match[1]);
    }

    const lines = packageDump.split('\n');
    let inRequestedPermissions = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!inRequestedPermissions) {
            if (trimmed.toLowerCase() === 'requested permissions:') {
                inRequestedPermissions = true;
            }
            continue;
        }

        if (!trimmed) {
            continue;
        }

        if (trimmed.endsWith(':') && !trimmed.includes('.')) {
            break;
        }

        if (/^[A-Za-z0-9_.]+$/.test(trimmed) && trimmed.includes('.')) {
            permissions.add(trimmed);
            continue;
        }

        if (trimmed.includes(':')) {
            break;
        }
    }

    return [...permissions];
}

export async function grantAndroidAppPermissions(
    device: { shell(command: string): Promise<string> },
    appId: string,
    log: AndroidRuntimeLogger,
    browserId?: string
): Promise<void> {
    try {
        const packageDump = await device.shell(`dumpsys package ${appId}`);
        const permissions = extractAndroidPermissionsFromDumpsys(packageDump);

        if (permissions.length === 0) {
            log(`No grantable permissions detected for ${appId}; skipping auto-grant.`, 'info', browserId);
            return;
        }

        let granted = 0;
        let skipped = 0;

        for (const permission of permissions) {
            try {
                const output = (await device.shell(`pm grant ${appId} ${permission}`)).trim();
                if (!output) {
                    granted += 1;
                    continue;
                }

                skipped += 1;
                if (!/not a changeable permission type|operation not allowed|securityexception|unknown permission|java\.lang\./i.test(output)) {
                    log(`pm grant ${permission}: ${output}`, 'info', browserId);
                }
            } catch (error) {
                skipped += 1;
                const message = getErrorMessage(error);
                if (!/not a changeable permission type|operation not allowed|securityexception|unknown permission|java\.lang\./i.test(message)) {
                    log(`pm grant ${permission} failed: ${message}`, 'info', browserId);
                }
            }
        }

        log(`Auto-grant permissions attempted for ${appId}: ${granted} granted, ${skipped} skipped.`, 'info', browserId);
    } catch (error) {
        log(`Failed to auto-grant permissions for ${appId}: ${getErrorMessage(error)}`, 'error', browserId);
    }
}

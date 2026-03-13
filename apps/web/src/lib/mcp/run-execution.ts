import { prisma } from '@/lib/core/prisma';
import { parseTestCaseJson, cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import { validateTargetUrl } from '@/lib/security/url-security';
import { getTeamDevicesAvailability } from '@/lib/runners/availability-service';
import {
    ANDROID_EXECUTION_CAPABILITY,
    ANDROID_EXECUTION_RUNNER_KIND,
    BROWSER_EXECUTION_CAPABILITY,
} from '@/lib/runners/constants';
import { dispatchBrowserRun } from '@/lib/runtime/browser-run-dispatcher';
import { normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { TEST_STATUS, type BrowserConfig, type TargetConfig, type AndroidTargetConfig, type TestStep } from '@/types';

const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';

function buildEmulatorProfileRequestedDeviceId(profileName: string): string {
    return `${EMULATOR_PROFILE_DEVICE_PREFIX}${profileName}`;
}

function isAndroidTargetConfig(config: BrowserConfig | TargetConfig): config is AndroidTargetConfig {
    return 'type' in config && config.type === 'android';
}

function hasAndroidTargets(browserConfig: Record<string, BrowserConfig | TargetConfig> | undefined): boolean {
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return false;
    }

    return Object.values(browserConfig).some(isAndroidTargetConfig);
}

function extractRequestedDeviceId(browserConfig: Record<string, BrowserConfig | TargetConfig> | undefined): string | null {
    const requestedDeviceIds = collectAndroidRequestedDeviceIds(browserConfig);
    if (requestedDeviceIds.size !== 1) {
        return null;
    }
    return requestedDeviceIds.values().next().value ?? null;
}

function collectAndroidRequestedDeviceIds(
    browserConfig: Record<string, BrowserConfig | TargetConfig> | undefined
): Set<string> {
    const requestedDeviceIds = new Set<string>();
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return requestedDeviceIds;
    }

    for (const target of Object.values(browserConfig).filter(isAndroidTargetConfig)) {
        const selector = normalizeAndroidTargetConfig(target).deviceSelector;
        if (selector.mode === 'connected-device' && selector.serial) {
            requestedDeviceIds.add(selector.serial);
            continue;
        }
        if (selector.mode === 'emulator-profile' && selector.emulatorProfileName) {
            requestedDeviceIds.add(buildEmulatorProfileRequestedDeviceId(selector.emulatorProfileName));
        }
    }

    return requestedDeviceIds;
}

function extractRequestedRunnerId(browserConfig: Record<string, BrowserConfig | TargetConfig> | undefined): string | null {
    const requestedRunnerIds = collectAndroidRequestedRunnerIds(browserConfig);
    if (requestedRunnerIds.size !== 1) {
        return null;
    }
    return requestedRunnerIds.values().next().value ?? null;
}

function collectAndroidRequestedRunnerIds(
    browserConfig: Record<string, BrowserConfig | TargetConfig> | undefined
): Set<string> {
    const requestedRunnerIds = new Set<string>();
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return requestedRunnerIds;
    }

    for (const target of Object.values(browserConfig).filter(isAndroidTargetConfig)) {
        const runnerId = target.runnerScope?.runnerId;
        if (typeof runnerId === 'string' && runnerId.trim().length > 0) {
            requestedRunnerIds.add(runnerId.trim());
        }
    }

    return requestedRunnerIds;
}

function isEmulatorProfileInventoryDevice(device: { deviceId: string; metadata: Record<string, unknown> | null }): boolean {
    return device.deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX)
        || device.metadata?.inventoryKind === 'emulator-profile';
}

function validateConfigUrls(config: {
    url?: string;
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}): string | null {
    const urls: string[] = [];
    if (config.url) urls.push(config.url);
    if (config.browserConfig) {
        for (const entry of Object.values(config.browserConfig)) {
            if ('type' in entry && entry.type === 'android') continue;
            if (entry.url) urls.push(entry.url);
        }
    }

    for (const url of urls) {
        const result = validateTargetUrl(url);
        if (!result.valid) {
            return result.error || 'Target URL is not allowed';
        }
    }

    return null;
}

function validateAndroidTargets(
    browserConfig: Record<string, BrowserConfig | TargetConfig> | undefined
): string | null {
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return null;
    }

    const androidTargets = Object.values(browserConfig).filter(isAndroidTargetConfig);
    if (androidTargets.length === 0) {
        return null;
    }

    for (const target of androidTargets) {
        const normalizedTarget = normalizeAndroidTargetConfig(target);
        const selector = normalizedTarget.deviceSelector;

        if (selector.mode === 'emulator-profile' && !selector.emulatorProfileName) {
            return 'Android target must include a device';
        }
        if (selector.mode === 'connected-device' && !selector.serial) {
            return 'Android target must include a device';
        }
        if (!target.appId) {
            return 'Android target must include an app ID';
        }
        if (typeof target.clearAppState !== 'boolean') {
            return 'Android target clearAppState must be a boolean';
        }
        if (typeof target.allowAllPermissions !== 'boolean') {
            return 'Android target allowAllPermissions must be a boolean';
        }
    }

    return null;
}

function createConfigurationSnapshot(config: {
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    requestedDeviceId?: string | null;
    requestedRunnerId?: string | null;
}) {
    return config;
}

export interface RunTestOverrides {
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    requestedDeviceId?: string;
    requestedRunnerId?: string;
}

export interface QueueTestCaseRunResult {
    runId: string;
    status: string;
    requiredCapability: string | null;
    requestedDeviceId: string | null;
    requestedRunnerId: string | null;
}

export interface QueueTestCaseRunFailure {
    error: string;
    details?: unknown;
}

export async function queueTestCaseRun(
    userId: string,
    testCaseId: string,
    overrides?: RunTestOverrides
): Promise<{ ok: true; data: QueueTestCaseRunResult } | { ok: false; failure: QueueTestCaseRunFailure }> {
    const testCase = await prisma.testCase.findUnique({
        where: { id: testCaseId },
        include: {
            files: {
                select: { filename: true, storedName: true, mimeType: true, size: true },
            },
            project: {
                select: {
                    teamId: true,
                    team: {
                        select: {
                            openRouterKeyEncrypted: true,
                            memberships: {
                                where: { userId },
                                select: { id: true },
                                take: 1,
                            }
                        }
                    }
                }
            }
        }
    });

    if (!testCase) {
        return { ok: false, failure: { error: 'Test case not found' } };
    }

    if (testCase.project.team.memberships.length === 0) {
        return { ok: false, failure: { error: 'Forbidden' } };
    }

    if (!testCase.project.team.openRouterKeyEncrypted) {
        return { ok: false, failure: { error: 'Please configure this team OpenRouter API key' } };
    }

    const parsedTestCase = parseTestCaseJson({
        url: testCase.url,
        prompt: testCase.prompt,
        steps: testCase.steps,
        browserConfig: testCase.browserConfig,
    });

    const normalizedSteps = overrides?.steps ? cleanStepsForStorage(overrides.steps) : parsedTestCase.steps;
    const normalizedBrowserConfig = overrides?.browserConfig
        ? normalizeTargetConfigMap(overrides.browserConfig)
        : parsedTestCase.browserConfig;
    const normalizedPrompt = overrides?.prompt ?? parsedTestCase.prompt ?? undefined;
    const normalizedUrl = overrides?.url ?? parsedTestCase.url;

    const hasBrowserConfig = !!normalizedBrowserConfig && Object.keys(normalizedBrowserConfig).length > 0;
    if (!hasBrowserConfig && !normalizedUrl) {
        return { ok: false, failure: { error: 'Valid configuration (URL or BrowserConfig) is required' } };
    }
    if ((!normalizedSteps || normalizedSteps.length === 0) && !normalizedPrompt) {
        return { ok: false, failure: { error: 'Instructions (Prompt or Steps) are required' } };
    }

    const urlValidationError = validateConfigUrls({
        url: normalizedUrl,
        browserConfig: normalizedBrowserConfig,
    });
    if (urlValidationError) {
        return { ok: false, failure: { error: urlValidationError } };
    }

    const androidValidationError = validateAndroidTargets(normalizedBrowserConfig);
    if (androidValidationError) {
        return { ok: false, failure: { error: androidValidationError } };
    }

    const requestHasAndroidTargets = hasAndroidTargets(normalizedBrowserConfig);
    const requestedDeviceIdInput = typeof overrides?.requestedDeviceId === 'string'
        ? overrides.requestedDeviceId.trim()
        : '';
    const requestedRunnerIdInput = typeof overrides?.requestedRunnerId === 'string'
        ? overrides.requestedRunnerId.trim()
        : '';

    if (!requestHasAndroidTargets && requestedDeviceIdInput) {
        return { ok: false, failure: { error: 'requestedDeviceId requires Android targets' } };
    }

    if (!requestHasAndroidTargets && requestedRunnerIdInput) {
        return { ok: false, failure: { error: 'requestedRunnerId requires Android targets' } };
    }

    const inferredRequestedDeviceId = extractRequestedDeviceId(normalizedBrowserConfig);
    const androidRequestedDeviceIds = collectAndroidRequestedDeviceIds(normalizedBrowserConfig);
    const inferredRequestedRunnerId = extractRequestedRunnerId(normalizedBrowserConfig);
    const androidRequestedRunnerIds = collectAndroidRequestedRunnerIds(normalizedBrowserConfig);
    const requestedDeviceId = requestHasAndroidTargets
        ? (requestedDeviceIdInput || inferredRequestedDeviceId)
        : null;
    const requestedRunnerId = requestHasAndroidTargets
        ? (requestedRunnerIdInput || inferredRequestedRunnerId || null)
        : null;

    if (requestHasAndroidTargets && !requestedDeviceId) {
        return {
            ok: false,
            failure: {
                error: 'Android runs require a single requestedDeviceId. Align Android target selectors or provide requestedDeviceId override.'
            },
        };
    }

    if (
        requestHasAndroidTargets
        && requestedDeviceIdInput
        && !androidRequestedDeviceIds.has(requestedDeviceIdInput)
    ) {
        return { ok: false, failure: { error: 'requestedDeviceId must match an Android target device selector' } };
    }

    if (
        requestHasAndroidTargets
        && requestedRunnerIdInput
        && androidRequestedRunnerIds.size > 0
        && !androidRequestedRunnerIds.has(requestedRunnerIdInput)
    ) {
        return { ok: false, failure: { error: 'requestedRunnerId must match an Android target runner scope' } };
    }
    if (
        requestHasAndroidTargets
        && !requestedRunnerIdInput
        && androidRequestedRunnerIds.size > 1
    ) {
        return {
            ok: false,
            failure: {
                error: 'Android targets specify multiple runner scopes; provide requestedRunnerId override or align target runnerScope values'
            }
        };
    }

    if (requestHasAndroidTargets && requestedDeviceId) {
        const availability = await getTeamDevicesAvailability(testCase.project.teamId);
        const selectedDevice = requestedRunnerId
            ? availability.devices.find((device) => (
                device.deviceId === requestedDeviceId && device.runnerId === requestedRunnerId
            ))
            : availability.devices.find((device) => device.deviceId === requestedDeviceId);

        const emulatorProfileClaimable = selectedDevice
            && isEmulatorProfileInventoryDevice(selectedDevice)
            && selectedDevice.isFresh
            && availability.runnerConnected;

        if (!selectedDevice || (!selectedDevice.isAvailable && !emulatorProfileClaimable)) {
            return {
                ok: false,
                failure: {
                    error: 'Selected device is no longer available. Check Team Settings > Runners and choose an available device.'
                }
            };
        }
    }

    const configurationSnapshot = JSON.stringify(createConfigurationSnapshot({
        url: normalizedUrl,
        prompt: normalizedPrompt,
        steps: normalizedSteps,
        browserConfig: normalizedBrowserConfig,
        requestedDeviceId,
        requestedRunnerId,
    }));

    const testRun = await prisma.testRun.create({
        data: {
            testCaseId,
            status: TEST_STATUS.QUEUED,
            configurationSnapshot,
            requiredCapability: requestHasAndroidTargets
                ? ANDROID_EXECUTION_CAPABILITY
                : BROWSER_EXECUTION_CAPABILITY,
            requiredRunnerKind: requestHasAndroidTargets
                ? ANDROID_EXECUTION_RUNNER_KIND
                : null,
            requestedDeviceId,
            requestedRunnerId,
        }
    });

    if (testCase.files.length > 0) {
        await prisma.testRunFile.createMany({
            data: testCase.files.map((file) => ({
                runId: testRun.id,
                filename: file.filename,
                storedName: file.storedName,
                mimeType: file.mimeType,
                size: file.size,
            }))
        });
    }

    if (!requestHasAndroidTargets) {
        await dispatchBrowserRun(testRun.id);
    }

    return {
        ok: true,
        data: {
            runId: testRun.id,
            status: testRun.status,
            requiredCapability: testRun.requiredCapability,
            requestedDeviceId: testRun.requestedDeviceId,
            requestedRunnerId: testRun.requestedRunnerId,
        }
    };
}

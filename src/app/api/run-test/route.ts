import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { validateTargetUrl } from '@/lib/security/url-security';
import { createLogger } from '@/lib/core/logger';
import { getTeamDevicesAvailability } from '@/lib/runners/availability-service';
import { config as appConfig } from '@/config/app';
import { normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { startLocalBrowserRun } from '@/lib/runtime/local-browser-runner';
import type { BrowserConfig, TargetConfig, AndroidTargetConfig, TestStep } from '@/types';

const logger = createLogger('api:run-test');

export const dynamic = 'force-dynamic';

interface RunTestRequest {
    name?: string;
    displayId?: string;
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    requestedDeviceId?: string;
    testCaseId?: string;
}

const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';

function buildEmulatorProfileRequestedDeviceId(profileName: string): string {
    return `${EMULATOR_PROFILE_DEVICE_PREFIX}${profileName}`;
}

function createConfigurationSnapshot(config: RunTestRequest) {
    const { testCaseId, ...sanitized } = config;
    void testCaseId;

    return sanitized;
}

function validateConfigUrls(config: RunTestRequest): string | null {
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

function isAndroidTargetConfig(config: BrowserConfig | TargetConfig): config is AndroidTargetConfig {
    return 'type' in config && config.type === 'android';
}

function hasAndroidTargets(browserConfig: RunTestRequest['browserConfig']): boolean {
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return false;
    }

    return Object.values(browserConfig).some(isAndroidTargetConfig);
}

function extractRequestedDeviceId(browserConfig: RunTestRequest['browserConfig']): string | null {
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return null;
    }

    for (const target of Object.values(browserConfig).filter(isAndroidTargetConfig)) {
        const selector = normalizeAndroidTargetConfig(target).deviceSelector;
        if (selector.mode === 'connected-device') {
            return selector.serial;
        }
        if (selector.mode === 'emulator-profile' && selector.emulatorProfileName) {
            return buildEmulatorProfileRequestedDeviceId(selector.emulatorProfileName);
        }
    }

    return null;
}

function isEmulatorProfileInventoryDevice(device: { deviceId: string; metadata: Record<string, unknown> | null }): boolean {
    return device.deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX)
        || device.metadata?.inventoryKind === 'emulator-profile';
}

async function validateAndroidTargets(
    browserConfig: RunTestRequest['browserConfig']
): Promise<string | null> {
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

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader) {
        const contentLength = Number.parseInt(contentLengthHeader, 10);
        if (Number.isFinite(contentLength) && contentLength > appConfig.api.maxRunRequestBodyBytes) {
            return NextResponse.json(
                { error: 'Request body too large' },
                { status: 413 }
            );
        }
    }

    const config = await request.json() as RunTestRequest;
    const { url, prompt, steps, browserConfig, testCaseId } = config;

    const hasBrowserConfig = browserConfig && Object.keys(browserConfig).length > 0;
    const hasSteps = steps && steps.length > 0;
    const hasPrompt = !!prompt;

    if (!hasBrowserConfig && !url) {
        return NextResponse.json(
            { error: 'Valid configuration (URL or BrowserConfig) is required' },
            { status: 400 }
        );
    }

    if (!hasSteps && !hasPrompt) {
        return NextResponse.json(
            { error: 'Instructions (Prompt or Steps) are required' },
            { status: 400 }
        );
    }

    const urlValidationError = validateConfigUrls(config);
    if (urlValidationError) {
        return NextResponse.json(
            { error: urlValidationError },
            { status: 400 }
        );
    }

    try {
        if (!testCaseId) {
            return NextResponse.json(
                { error: 'TestCase ID is required for background execution' },
                { status: 400 }
            );
        }

        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const requestHasAndroidTargets = hasAndroidTargets(browserConfig);

        const testCase = await prisma.testCase.findUnique({
            where: { id: testCaseId },
            include: {
                project: {
                    select: {
                        id: true,
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
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.team.memberships.length === 0) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const androidValidationError = await validateAndroidTargets(browserConfig);
        if (androidValidationError) {
            return NextResponse.json({ error: androidValidationError }, { status: 400 });
        }

        if (!testCase.project.team.openRouterKeyEncrypted) {
            return NextResponse.json(
                { error: 'Please configure this team OpenRouter API key' },
                { status: 400 }
            );
        }

        const files = await prisma.testCaseFile.findMany({
            where: { testCaseId },
            select: { id: true, filename: true, storedName: true, mimeType: true, size: true }
        });

        const configurationSnapshot = JSON.stringify(createConfigurationSnapshot(config));
        const requestedDeviceIdInput = typeof config.requestedDeviceId === 'string'
            ? config.requestedDeviceId.trim()
            : '';

        if (!requestHasAndroidTargets && requestedDeviceIdInput) {
            return NextResponse.json(
                { error: 'requestedDeviceId requires Android targets' },
                { status: 400 }
            );
        }

        const inferredRequestedDeviceId = extractRequestedDeviceId(browserConfig);
        const requestedDeviceId = requestHasAndroidTargets
            ? (requestedDeviceIdInput || inferredRequestedDeviceId)
            : null;

        if (requestHasAndroidTargets && requestedDeviceId) {
            const availability = await getTeamDevicesAvailability(testCase.project.teamId);
            const selectedDevice = availability?.devices.find((device) => device.deviceId === requestedDeviceId);

            const emulatorProfileClaimable = selectedDevice
                && isEmulatorProfileInventoryDevice(selectedDevice)
                && selectedDevice.isFresh
                && availability.runnerConnected;

            if (!selectedDevice || (!selectedDevice.isAvailable && !emulatorProfileClaimable)) {
                return NextResponse.json(
                    { error: 'Selected device is no longer available. Check Team Settings > Runners and choose an available device.' },
                    { status: 409 }
                );
            }
        }

        const testRun = await prisma.testRun.create({
            data: {
                testCaseId,
                status: requestHasAndroidTargets ? 'QUEUED' : 'PREPARING',
                configurationSnapshot,
                requiredCapability: requestHasAndroidTargets ? 'ANDROID' : null,
                requiredRunnerKind: requestHasAndroidTargets ? 'MACOS_AGENT' : null,
                requestedDeviceId,
            }
        });

        logger.info('Created test run', {
            runId: testRun.id,
            testCaseId,
            status: testRun.status,
            requiredCapability: testRun.requiredCapability,
            requiredRunnerKind: testRun.requiredRunnerKind,
            requestedDeviceId: testRun.requestedDeviceId,
            hasAndroidTargets: requestHasAndroidTargets,
        });

        if (files && files.length > 0) {
            try {
                await prisma.testRunFile.createMany({
                    data: files.map((f) => ({
                        runId: testRun.id,
                        filename: f.filename,
                        storedName: f.storedName,
                        mimeType: f.mimeType,
                        size: f.size,
                    }))
                });
            } catch (e) {
                logger.warn('Failed to snapshot run files', e);
            }
        }

        if (!requestHasAndroidTargets) {
            startLocalBrowserRun(testRun.id);
            logger.info('Started local browser execution for run', {
                runId: testRun.id,
            });
        }

        return NextResponse.json({
            runId: testRun.id,
            status: testRun.status,
            requiredCapability: testRun.requiredCapability,
            requestedDeviceId: testRun.requestedDeviceId,
        });

    } catch (error) {
        logger.error('Failed to submit test job', error);
        return NextResponse.json(
            { error: 'Failed to submit test job' },
            { status: 500 }
        );
    }
}

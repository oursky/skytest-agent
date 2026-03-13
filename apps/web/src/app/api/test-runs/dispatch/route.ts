import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { validateTargetUrl } from '@/lib/security/url-security';
import { createLogger } from '@/lib/core/logger';
import { getTeamDevicesAvailability } from '@/lib/runners/availability-service';
import { config as appConfig } from '@/config/app';
import { isAndroidTargetConfig, normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import {
    collectAndroidRequestedDeviceIds,
    collectAndroidRequestedRunnerIds,
    extractRequestedDeviceId,
    extractRequestedRunnerId,
    hasAndroidTargets,
    isEmulatorProfileInventoryDevice,
} from '@/lib/android/target-requests';
import {
    ANDROID_EXECUTION_CAPABILITY,
    ANDROID_EXECUTION_RUNNER_KIND,
    BROWSER_EXECUTION_CAPABILITY,
} from '@/lib/runners/constants';
import { dispatchBrowserRun } from '@/lib/runtime/browser-run-dispatcher';
import { TEST_STATUS, type BrowserConfig, type TargetConfig, type TestStep } from '@/types';

const logger = createLogger('api:test-runs-dispatch');

export const dynamic = 'force-dynamic';

interface RunTestRequest {
    name?: string;
    displayId?: string;
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    requestedDeviceId?: string;
    requestedRunnerId?: string;
    testCaseId?: string;
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
        const requestedRunnerIdInput = typeof config.requestedRunnerId === 'string'
            ? config.requestedRunnerId.trim()
            : '';

        if (!requestHasAndroidTargets && requestedDeviceIdInput) {
            return NextResponse.json(
                { error: 'requestedDeviceId requires Android targets' },
                { status: 400 }
            );
        }

        if (!requestHasAndroidTargets && requestedRunnerIdInput) {
            return NextResponse.json(
                { error: 'requestedRunnerId requires Android targets' },
                { status: 400 }
            );
        }

        const inferredRequestedDeviceId = extractRequestedDeviceId(browserConfig);
        const androidRequestedDeviceIds = collectAndroidRequestedDeviceIds(browserConfig);
        const inferredRequestedRunnerId = extractRequestedRunnerId(browserConfig);
        const androidRequestedRunnerIds = collectAndroidRequestedRunnerIds(browserConfig);
        const requestedDeviceId = requestHasAndroidTargets
            ? (requestedDeviceIdInput || inferredRequestedDeviceId)
            : null;
        const requestedRunnerId = requestHasAndroidTargets
            ? (requestedRunnerIdInput || inferredRequestedRunnerId || null)
            : null;

        if (requestHasAndroidTargets && !requestedDeviceId) {
            return NextResponse.json(
                { error: 'Android runs require a single requestedDeviceId. Align Android target selectors or provide requestedDeviceId override.' },
                { status: 400 }
            );
        }

        if (
            requestHasAndroidTargets
            && requestedDeviceIdInput
            && !androidRequestedDeviceIds.has(requestedDeviceIdInput)
        ) {
            return NextResponse.json(
                { error: 'requestedDeviceId must match an Android target device selector' },
                { status: 400 }
            );
        }

        if (
            requestHasAndroidTargets
            && requestedRunnerIdInput
            && androidRequestedRunnerIds.size > 0
            && !androidRequestedRunnerIds.has(requestedRunnerIdInput)
        ) {
            return NextResponse.json(
                { error: 'requestedRunnerId must match an Android target runner scope' },
                { status: 400 }
            );
        }
        if (
            requestHasAndroidTargets
            && !requestedRunnerIdInput
            && androidRequestedRunnerIds.size > 1
        ) {
            return NextResponse.json(
                { error: 'Android targets specify multiple runner scopes; provide requestedRunnerId override or align target runnerScope values' },
                { status: 400 }
            );
        }

        if (requestHasAndroidTargets && requestedDeviceId) {
            const availability = await getTeamDevicesAvailability(testCase.project.teamId);
            const selectedDevice = requestedRunnerId
                ? availability?.devices.find((device) => (
                    device.deviceId === requestedDeviceId && device.runnerId === requestedRunnerId
                ))
                : availability?.devices.find((device) => device.deviceId === requestedDeviceId);

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

        logger.info('Created test run', {
            runId: testRun.id,
            testCaseId,
            status: testRun.status,
            requiredCapability: testRun.requiredCapability,
            requiredRunnerKind: testRun.requiredRunnerKind,
            requestedDeviceId: testRun.requestedDeviceId,
            requestedRunnerId: testRun.requestedRunnerId,
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
            const dispatched = await dispatchBrowserRun(testRun.id);
            if (!dispatched) {
                logger.warn('Browser run dispatch skipped because run was not claimable', {
                    runId: testRun.id,
                    status: testRun.status,
                    requiredCapability: testRun.requiredCapability,
                    requiredRunnerKind: testRun.requiredRunnerKind,
                });
            }
        }

        return NextResponse.json({
            runId: testRun.id,
            status: testRun.status,
            requiredCapability: testRun.requiredCapability,
            requestedDeviceId: testRun.requestedDeviceId,
            requestedRunnerId: testRun.requestedRunnerId,
        });

    } catch (error) {
        logger.error('Failed to submit test job', error);
        return NextResponse.json(
            { error: 'Failed to submit test job' },
            { status: 500 }
        );
    }
}

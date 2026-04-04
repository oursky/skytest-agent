import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { getTeamDevicesAvailability } from '@/lib/runners/availability-service';
import { config as appConfig } from '@/config/app';
import { isAndroidTargetConfig, normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { resolveConfigs } from '@/lib/test-config/resolver';
import { hasTemplatedConfigUrls, validateConfigUrls } from '@/lib/test-config/url-validation';
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
import { TEST_STATUS, type BrowserConfig, type ResolvedConfig, type TargetConfig, type TestStep } from '@/types';
import { guardTestCaseRouteRequest } from '@/lib/security/test-case-route-access';
import { apiError } from '@/lib/security/api-route-standards';

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

function createConfigurationSnapshot(
    config: RunTestRequest,
    resolvedConfigurations: ResolvedConfig[] = []
) {
    const { testCaseId, ...sanitized } = config;
    void testCaseId;

    return {
        ...sanitized,
        resolvedConfigurations,
    };
}

async function resolveTriggeredByEmail(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
    });

    return typeof user?.email === 'string' ? user.email : null;
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
    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader) {
        const contentLength = Number.parseInt(contentLengthHeader, 10);
        if (Number.isFinite(contentLength) && contentLength > appConfig.api.maxRunRequestBodyBytes) {
            return apiError({
                status: 413,
                code: 'VALIDATION_ERROR',
                error: 'Request body too large',
            });
        }
    }

    const config = await request.json() as RunTestRequest;
    const { url, prompt, steps, browserConfig, testCaseId } = config;

    const hasBrowserConfig = browserConfig && Object.keys(browserConfig).length > 0;
    const hasSteps = steps && steps.length > 0;
    const hasPrompt = !!prompt;

    if (!hasBrowserConfig && !url) {
        return apiError({
            status: 400,
            code: 'VALIDATION_ERROR',
            error: 'Valid configuration (URL or BrowserConfig) is required',
        });
    }

    if (!hasSteps && !hasPrompt) {
        return apiError({
            status: 400,
            code: 'VALIDATION_ERROR',
            error: 'Instructions (Prompt or Steps) are required',
        });
    }

    try {
        if (!testCaseId) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'TestCase ID is required for background execution',
            });
        }

        const guard = await guardTestCaseRouteRequest({
            request,
            params: Promise.resolve({ id: testCaseId }),
        });
        if (!guard.ok) {
            return guard.response;
        }

        const userId = guard.userId;
        const triggeredByEmail = await resolveTriggeredByEmail(userId);
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
                            }
                        }
                    }
                }
            }
        });

        if (!testCase) {
            return apiError({
                status: 404,
                code: 'NOT_FOUND',
                error: 'Test case not found',
            });
        }

        const requiresResolvedVariables = hasTemplatedConfigUrls({ url, browserConfig });
        let resolvedVariables: Record<string, string> = {};
        let resolvedConfigurations: ResolvedConfig[] = [];
        try {
            const resolvedConfigs = await resolveConfigs(testCase.project.id, testCaseId);
            resolvedConfigurations = resolvedConfigs.allConfigs;
            if (requiresResolvedVariables) {
                resolvedVariables = resolvedConfigs.variables;
            }
        } catch (error) {
            if (requiresResolvedVariables) {
                throw error;
            }
            logger.warn('Failed to resolve configs for run snapshot', error);
        }

        const urlValidationError = validateConfigUrls({ url, browserConfig }, resolvedVariables);
        if (urlValidationError) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: urlValidationError,
            });
        }

        const androidValidationError = await validateAndroidTargets(browserConfig);
        if (androidValidationError) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: androidValidationError,
            });
        }

        if (!testCase.project.team.openRouterKeyEncrypted) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Please configure this team OpenRouter API key',
            });
        }

        const files = await prisma.testCaseFile.findMany({
            where: { testCaseId },
            select: { id: true, filename: true, storedName: true, mimeType: true, size: true }
        });

        const configurationSnapshot = JSON.stringify(createConfigurationSnapshot(config, resolvedConfigurations));
        const requestedDeviceIdInput = typeof config.requestedDeviceId === 'string'
            ? config.requestedDeviceId.trim()
            : '';
        const requestedRunnerIdInput = typeof config.requestedRunnerId === 'string'
            ? config.requestedRunnerId.trim()
            : '';

        if (!requestHasAndroidTargets && requestedDeviceIdInput) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'requestedDeviceId requires Android targets',
            });
        }

        if (!requestHasAndroidTargets && requestedRunnerIdInput) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'requestedRunnerId requires Android targets',
            });
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
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Android runs require a single requestedDeviceId. Align Android target selectors or provide requestedDeviceId override.',
            });
        }

        if (
            requestHasAndroidTargets
            && requestedDeviceIdInput
            && !androidRequestedDeviceIds.has(requestedDeviceIdInput)
        ) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'requestedDeviceId must match an Android target device selector',
            });
        }

        if (
            requestHasAndroidTargets
            && requestedRunnerIdInput
            && androidRequestedRunnerIds.size > 0
            && !androidRequestedRunnerIds.has(requestedRunnerIdInput)
        ) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'requestedRunnerId must match an Android target runner scope',
            });
        }
        if (
            requestHasAndroidTargets
            && !requestedRunnerIdInput
            && androidRequestedRunnerIds.size > 1
        ) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Android targets specify multiple runner scopes; provide requestedRunnerId override or align target runnerScope values',
            });
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
                return apiError({
                    status: 409,
                    code: 'CONFLICT',
                    error: 'Selected device is no longer available. Check Team Settings > Runners and choose an available device.',
                });
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
                triggeredByEmail,
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
        return NextResponse.json({
            runId: testRun.id,
            status: testRun.status,
            requiredCapability: testRun.requiredCapability,
            requestedDeviceId: testRun.requestedDeviceId,
            requestedRunnerId: testRun.requestedRunnerId,
        });

    } catch (error) {
        logger.error('Failed to submit test job', error);
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to submit test job',
        });
    }
}

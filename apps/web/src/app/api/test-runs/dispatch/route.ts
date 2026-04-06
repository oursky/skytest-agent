import { NextResponse } from 'next/server';
import path from 'node:path';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { getTeamDevicesAvailability } from '@/lib/runners/availability-service';
import { config as appConfig } from '@/config/app';
import { isAndroidTargetConfig, normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { resolveConfigs } from '@/lib/test-config/resolver';
import { ensureRuntimeInstanceIdentity } from '@/lib/runtime/instance-identity';
import { loadRuntimeConfigForCwd } from '@/lib/runtime/runtime-config-loader';
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
    resolvedConfigurations: ResolvedConfig[] = [],
    runtimeConfig?: {
        runtime: {
            baseUrl: string;
            browser: {
                headless: boolean;
                timeoutMs: number;
            };
            timeouts: {
                stepMs: number;
                runMs: number;
            };
            env?: Record<string, string>;
            headers?: Record<string, string>;
        };
        schemaVersion: number;
    }
) {
    const { testCaseId, ...sanitized } = config;
    void testCaseId;

    return {
        ...sanitized,
        resolvedConfigurations,
        ...(runtimeConfig
            ? {
                runtime: runtimeConfig.runtime,
                runtimeConfigSource: {
                    path: '.skytest/skytest.yaml',
                    schemaVersion: runtimeConfig.schemaVersion,
                },
            }
            : {}),
    };
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'Unknown error';
}

function resolveRuntimeRootFromSourcePath(sourcePath: string | null | undefined): string | null {
    if (!sourcePath) {
        return null;
    }

    const normalizedPath = path.normalize(sourcePath);
    const marker = `${path.sep}.skytest${path.sep}`;
    const markerIndex = normalizedPath.indexOf(marker);
    if (markerIndex < 0) {
        return null;
    }

    return normalizedPath.slice(0, markerIndex);
}

function mergeResolvedConfigurationsWithRuntimeEnv(
    resolvedConfigurations: ResolvedConfig[],
    runtimeEnv?: Record<string, string>
): ResolvedConfig[] {
    if (!runtimeEnv || Object.keys(runtimeEnv).length === 0) {
        return resolvedConfigurations;
    }

    const merged = new Map<string, ResolvedConfig>();
    for (const config of resolvedConfigurations) {
        merged.set(config.name, config);
    }

    for (const [name, value] of Object.entries(runtimeEnv)) {
        if (!name || typeof value !== 'string') {
            continue;
        }

        merged.set(name, {
            name,
            type: 'VARIABLE',
            value,
            masked: /PASSWORD|TOKEN|SECRET|KEY/i.test(name),
            source: 'project',
        });
    }

    return Array.from(merged.values());
}

async function syncRuntimeEnvProjectConfigs(
    projectId: string,
    runtimeEnv?: Record<string, string>,
): Promise<void> {
    if (!runtimeEnv || Object.keys(runtimeEnv).length === 0) {
        return;
    }

    for (const [name, value] of Object.entries(runtimeEnv)) {
        if (!name || typeof value !== 'string') {
            continue;
        }

        const trimmedValue = value.trim();
        if (!trimmedValue) {
            continue;
        }

        await prisma.projectConfig.upsert({
            where: {
                projectId_name: {
                    projectId,
                    name,
                },
            },
            create: {
                projectId,
                name,
                type: 'VARIABLE',
                value: trimmedValue,
                masked: /PASSWORD|TOKEN|SECRET|KEY/i.test(name),
            },
            update: {
                type: 'VARIABLE',
                value: trimmedValue,
                masked: /PASSWORD|TOKEN|SECRET|KEY/i.test(name),
            },
        });
    }
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
                error: 'Please configure this team AI provider key',
            });
        }

        const files = await prisma.testCaseFile.findMany({
            where: { testCaseId },
            select: { id: true, filename: true, storedName: true, mimeType: true, size: true }
        });

        const currentWorkingDirectory = process.cwd();
        const instanceIdentity = await ensureRuntimeInstanceIdentity(currentWorkingDirectory);
        let runtimeConfig;
        try {
            runtimeConfig = await loadRuntimeConfigForCwd(currentWorkingDirectory);
        } catch (cwdConfigError) {
            const sourceRuntimeRoot = resolveRuntimeRootFromSourcePath(testCase.source);
            if (!sourceRuntimeRoot) {
                return apiError({
                    status: 400,
                    code: 'VALIDATION_ERROR',
                    error: getErrorMessage(cwdConfigError),
                });
            }

            try {
                runtimeConfig = await loadRuntimeConfigForCwd(sourceRuntimeRoot);
            } catch {
                return apiError({
                    status: 400,
                    code: 'VALIDATION_ERROR',
                    error: getErrorMessage(cwdConfigError),
                });
            }
        }

        const snapshotConfigurations = mergeResolvedConfigurationsWithRuntimeEnv(
            resolvedConfigurations,
            runtimeConfig.runtime.env,
        );

        try {
            await syncRuntimeEnvProjectConfigs(testCase.project.id, runtimeConfig.runtime.env);
        } catch (syncError) {
            logger.warn('Failed to sync runtime env configs into project configs', {
                testCaseId,
                projectId: testCase.project.id,
                error: getErrorMessage(syncError),
            });
        }

        const configurationSnapshot = JSON.stringify(createConfigurationSnapshot(config, snapshotConfigurations, runtimeConfig));
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
                instanceId: instanceIdentity.instanceId,
                instanceType: instanceIdentity.instanceType,
                instanceName: instanceIdentity.instanceName,
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
            instanceId: testRun.instanceId,
            instanceType: testRun.instanceType,
            instanceName: testRun.instanceName,
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
            instanceId: testRun.instanceId,
            instanceType: testRun.instanceType,
            instanceName: testRun.instanceName,
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

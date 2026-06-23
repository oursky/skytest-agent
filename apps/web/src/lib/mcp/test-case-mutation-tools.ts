import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prisma } from '@/lib/core/prisma';
import { cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import { isGroupableConfigType, normalizeConfigGroup } from '@/lib/test-config/sort';
import { normalizeBrowserConfig } from '@/lib/test-config/browser-target';
import { validateConfigName, normalizeConfigName, validateConfigType, validateConfigValue } from '@/lib/test-config/validation';
import { resolveAndroidDeviceSelector, type AndroidDeviceSelectorInventory } from '@/lib/mcp/android-selector';
import { cancelRunDurably } from '@/lib/mcp/run-cancellation';
import { CANCELLATION_REASON } from '@/lib/runtime/cancellation-reasons';
import { getUserId, type McpHandlerExtra, verifyProjectAccess } from '@/lib/mcp/server-auth';
import { errorResult, textResult, withToolTelemetry, type ToolResponse } from '@/lib/mcp/server-response';
import { mcpConfigSchema, mcpStepSchema } from '@/lib/mcp/server-schemas';
import {
    RUN_ACTIVE_STATUSES,
    TEST_STATUS,
    type BrowserConfig,
    type ConfigType,
    type TargetConfig,
    type TestStep,
} from '@/types';
import { isTestCaseProjectMember } from '@/lib/security/permissions';

function readMetadataString(metadata: unknown, field: string): string | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return undefined;
    }
    const value = (metadata as Record<string, unknown>)[field];
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

async function listRunnerAndroidInventory(projectId: string): Promise<AndroidDeviceSelectorInventory | null> {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { teamId: true },
    });
    if (!project) {
        return null;
    }

    const devices = await prisma.runnerDevice.findMany({
        where: {
            platform: 'ANDROID',
            state: 'ONLINE',
            runner: {
                teamId: project.teamId,
                status: 'ONLINE',
            },
        },
        select: {
            deviceId: true,
            name: true,
            metadata: true,
        },
    });

    const connectedDevicesBySerial = new Map<string, AndroidDeviceSelectorInventory['connectedDevices'][number]>();
    const emulatorProfilesByName = new Map<string, AndroidDeviceSelectorInventory['emulatorProfiles'][number]>();

    for (const device of devices) {
        const serial = device.deviceId.trim();
        if (!serial) {
            continue;
        }

        const metadata = device.metadata;
        const kind = readMetadataString(metadata, 'kind') === 'emulator' ? 'emulator' : 'physical';
        const manufacturer = readMetadataString(metadata, 'manufacturer');
        const model = readMetadataString(metadata, 'model') ?? device.name;
        const emulatorProfileName = readMetadataString(metadata, 'emulatorProfileName');
        const emulatorProfileDisplayName = readMetadataString(metadata, 'emulatorProfileDisplayName') ?? emulatorProfileName;

        connectedDevicesBySerial.set(serial, {
            serial,
            kind,
            manufacturer,
            model,
            emulatorProfileName,
        });

        if (kind === 'emulator' && emulatorProfileName) {
            emulatorProfilesByName.set(emulatorProfileName, {
                name: emulatorProfileName,
                displayName: emulatorProfileDisplayName ?? emulatorProfileName,
            });
        }
    }

    return {
        connectedDevices: Array.from(connectedDevicesBySerial.values()),
        emulatorProfiles: Array.from(emulatorProfilesByName.values()),
    };
}

function buildTargetIdGenerator(existingIds: Set<string>, prefix: 'browser' | 'android') {
    let index = 0;
    return () => {
        while (true) {
            const suffix = index < 26 ? String.fromCharCode('a'.charCodeAt(0) + index) : String(index + 1);
            const candidate = `${prefix}_${suffix}`;
            index += 1;
            if (!existingIds.has(candidate)) {
                existingIds.add(candidate);
                return candidate;
            }
        }
    };
}

const mcpCreateTestCaseSchema = z.object({
    name: z.string().optional().describe('Test case name'),
    displayId: z.string().optional().describe('User-facing display ID'),
    testCaseId: z.string().optional().describe('Alias of displayId (import format)'),
    url: z.string().optional().describe('Base URL for browser target'),
    prompt: z.string().optional().describe('AI prompt (alternative to steps)'),
    steps: z.array(mcpStepSchema).optional().describe('Test steps'),
    browserConfig: z.record(z.string(), z.unknown()).optional().describe('Browser/Android target configs keyed by target ID'),
    browserTargets: z.array(z.object({
        id: z.string().optional().describe('Optional target ID'),
        name: z.string().optional().describe('Display name'),
        url: z.string().describe('Target URL'),
        width: z.number().optional().describe('Viewport width'),
        height: z.number().optional().describe('Viewport height'),
    })).optional().describe('Import-style browser targets'),
    androidTargets: z.array(z.object({
        id: z.string().optional().describe('Optional target ID'),
        name: z.string().optional().describe('Display name'),
        runnerId: z.string().optional().describe('Optional runner scope for this Android target'),
        device: z.string().optional().describe('Device selector text (e.g. serial:emulator-5554, profile name, or display name such as "Pixel 8")'),
        deviceSelector: z.object({
            mode: z.enum(['emulator-profile', 'connected-device']),
            emulatorProfileName: z.string().optional(),
            serial: z.string().optional(),
        }).optional().describe('Structured android device selector'),
        appId: z.string().optional().describe('Android app ID'),
        clearAppState: z.boolean().optional().describe('Clear app data before run'),
        allowAllPermissions: z.boolean().optional().describe('Auto grant runtime permissions'),
    })).optional().describe('Import-style android targets'),
    configs: z.array(mcpConfigSchema).optional().describe('Test case variables/configs'),
    variables: z.array(mcpConfigSchema).optional().describe('Alias of configs (import-style test case variables)'),
});

type McpCreateTestCaseInput = z.infer<typeof mcpCreateTestCaseSchema>;

export function registerTestCaseMutationTools(server: McpServer): void {
    const createTestCaseInputSchema = {
        projectId: z.string().describe('Project ID'),
        testCase: mcpCreateTestCaseSchema.describe('Test case to create'),
    };

    const createTestCaseHandler = async (
        { projectId, testCase }: { projectId: string; testCase: McpCreateTestCaseInput },
        extra: McpHandlerExtra
    ): Promise<ToolResponse> => {
        return withToolTelemetry('create_test_case', async () => {
            const userId = getUserId(extra);
            if (!userId) return errorResult('Unauthorized');
            if (!await verifyProjectAccess(projectId, userId)) return errorResult('Forbidden');

            const name = testCase.name?.trim();
            if (!name) {
                return errorResult('Name is required');
            }

            const warnings: string[] = [];
            const targetConfigMap: Record<string, BrowserConfig | TargetConfig> = {};
            const hasBrowserConfig = !!testCase.browserConfig
                && typeof testCase.browserConfig === 'object'
                && !Array.isArray(testCase.browserConfig)
                && Object.keys(testCase.browserConfig).length > 0;
            if (hasBrowserConfig) {
                Object.assign(
                    targetConfigMap,
                    normalizeTargetConfigMap(testCase.browserConfig as Record<string, BrowserConfig | TargetConfig>)
                );
            }

            const targetIds = new Set(Object.keys(targetConfigMap));
            const nextBrowserTargetId = buildTargetIdGenerator(targetIds, 'browser');
            const nextAndroidTargetId = buildTargetIdGenerator(targetIds, 'android');
            const androidInventory = Array.isArray(testCase.androidTargets) && testCase.androidTargets.length > 0
                ? await listRunnerAndroidInventory(projectId)
                : null;

            if (Array.isArray(testCase.browserTargets)) {
                for (const target of testCase.browserTargets) {
                    const requestedId = target.id?.trim();
                    let targetId = requestedId;
                    if (targetId) {
                        if (targetIds.has(targetId)) {
                            warnings.push(`Browser target "${targetId}" already exists, generated a new target ID instead.`);
                            targetId = nextBrowserTargetId();
                        } else {
                            targetIds.add(targetId);
                        }
                    } else {
                        targetId = nextBrowserTargetId();
                    }

                    targetConfigMap[targetId] = normalizeBrowserConfig({
                        name: target.name?.trim() || undefined,
                        url: target.url,
                        width: target.width,
                        height: target.height,
                    });
                }
            }

            if (Array.isArray(testCase.androidTargets)) {
                for (const target of testCase.androidTargets) {
                    const deviceSelector = resolveAndroidDeviceSelector(
                        target.device,
                        target.deviceSelector,
                        androidInventory ?? undefined
                    );
                    if (!deviceSelector) {
                        warnings.push(`Android target "${target.name || target.id || 'unnamed'}" skipped: missing or invalid device selector.`);
                        continue;
                    }

                    if (androidInventory) {
                        let foundInInventory = false;
                        let deviceLabel = target.device || 'unknown';
                        if (deviceSelector.mode === 'emulator-profile') {
                            deviceLabel = target.device || deviceSelector.emulatorProfileName;
                            foundInInventory = androidInventory.emulatorProfiles.some(
                                (profile) => profile.name === deviceSelector.emulatorProfileName
                            );
                        } else if (deviceSelector.mode === 'connected-device') {
                            deviceLabel = target.device || deviceSelector.serial;
                            foundInInventory = androidInventory.connectedDevices.some(
                                (device) => device.serial === deviceSelector.serial
                            );
                        }
                        if (!foundInInventory) {
                            warnings.push(`Android device "${deviceLabel}" was not found in the device inventory. Verify with the user before running.`);
                        }
                    }

                    const requestedId = target.id?.trim();
                    let targetId = requestedId;
                    if (targetId) {
                        if (targetIds.has(targetId)) {
                            warnings.push(`Android target "${targetId}" already exists, generated a new target ID instead.`);
                            targetId = nextAndroidTargetId();
                        } else {
                            targetIds.add(targetId);
                        }
                    } else {
                        targetId = nextAndroidTargetId();
                    }

                    targetConfigMap[targetId] = {
                        type: 'android',
                        name: target.name?.trim() || undefined,
                        deviceSelector,
                        runnerScope: target.runnerId ? { runnerId: target.runnerId.trim() } : undefined,
                        appId: target.appId || '',
                        clearAppState: target.clearAppState ?? true,
                        allowAllPermissions: target.allowAllPermissions ?? true,
                    };
                }
            }

            const hasSteps = Array.isArray(testCase.steps) && testCase.steps.length > 0;
            const cleanedSteps = hasSteps ? cleanStepsForStorage(testCase.steps as TestStep[]) : undefined;
            const hasTargetConfig = Object.keys(targetConfigMap).length > 0;
            const normalizedBrowserConfig = hasTargetConfig ? normalizeTargetConfigMap(targetConfigMap) : undefined;
            const displayId = testCase.displayId || testCase.testCaseId || undefined;
            const firstBrowserTarget = normalizedBrowserConfig
                ? Object.values(normalizedBrowserConfig).find((targetConfig) => !('type' in targetConfig && targetConfig.type === 'android')) as BrowserConfig | undefined
                : undefined;
            const normalizedUrl = testCase.url || firstBrowserTarget?.url || '';

            const createResult = await prisma.$transaction(async (tx) => {
                const created = await tx.testCase.create({
                    data: {
                        name,
                        url: normalizedUrl,
                        prompt: testCase.prompt,
                        steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
                        browserConfig: normalizedBrowserConfig ? JSON.stringify(normalizedBrowserConfig) : undefined,
                        projectId,
                        displayId,
                        status: TEST_STATUS.DRAFT,
                    },
                });

                let createdTestCaseVariableCount = 0;
                const testCaseVariables = [...(testCase.configs || []), ...(testCase.variables || [])];
                if (testCaseVariables.length > 0) {
                    const projectConfigs = await tx.projectConfig.findMany({ where: { projectId } });

                    for (const configInput of testCaseVariables) {
                        const nameError = validateConfigName(configInput.name);
                        if (nameError) {
                            warnings.push(`Config "${configInput.name}": ${nameError}`);
                            continue;
                        }
                        if (!validateConfigType(configInput.type)) {
                            warnings.push(`Config "${configInput.name}": invalid type "${configInput.type}"`);
                            continue;
                        }

                        const normalizedName = normalizeConfigName(configInput.name);
                        const configType = configInput.type as ConfigType;
                        const configValue = configInput.value ?? '';
                        const valueError = validateConfigValue(configType, configValue);
                        if (valueError) {
                            warnings.push(`Config "${normalizedName}": ${valueError}`);
                            continue;
                        }
                        if (configType === 'FILE') {
                            warnings.push(`Config "${normalizedName}" skipped: FILE upload is not supported in MCP create_test_case.`);
                            continue;
                        }

                        const projectConfigWithSameName = projectConfigs.find(
                            (projectConfig) => normalizeConfigName(projectConfig.name) === normalizedName && projectConfig.type === configType
                        );
                        if (configValue.length === 0 && projectConfigWithSameName) {
                            warnings.push(`Config "${normalizedName}" skipped: empty test-case value would override project config "${projectConfigWithSameName.name}".`);
                            continue;
                        }

                        const matchingProjectConfig = projectConfigs.find(
                            (projectConfig) => projectConfig.value === configValue && projectConfig.type === configType
                        );
                        if (matchingProjectConfig) {
                            warnings.push(`Config "${normalizedName}" skipped: project variable "${matchingProjectConfig.name}" already has the same value — use it instead`);
                            continue;
                        }

                        const groupable = isGroupableConfigType(configType);
                        try {
                            await tx.testCaseConfig.create({
                                data: {
                                    testCaseId: created.id,
                                    name: normalizedName,
                                    type: configType,
                                    value: configValue,
                                    masked: configType === 'VARIABLE' ? (configInput.masked ?? false) : false,
                                    group: groupable ? (normalizeConfigGroup(configInput.group) || null) : null,
                                }
                            });
                            createdTestCaseVariableCount += 1;
                        } catch (error: unknown) {
                            if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
                                warnings.push(`Config "${normalizedName}" already exists, skipped`);
                            } else {
                                warnings.push(`Config "${normalizedName}" creation failed`);
                            }
                        }
                    }
                }

                return { created, createdTestCaseVariableCount };
            });

            return textResult({
                id: createResult.created.id,
                name: createResult.created.name,
                displayId: createResult.created.displayId,
                createdTargets: normalizedBrowserConfig ? Object.keys(normalizedBrowserConfig).length : 0,
                createdTestCaseVariables: createResult.createdTestCaseVariableCount,
                warnings
            });
        });
    };

    server.registerTool('create_test_case', {
        description: 'Create exactly one test case per call with import-equivalent details (ID, targets, steps, test-case variables). FILE uploads are not supported via MCP.',
        inputSchema: createTestCaseInputSchema,
    }, createTestCaseHandler);

    const updateTestCaseHandler = async ({
        testCaseId,
        activeRunResolution,
        displayId,
        name,
        url,
        prompt,
        steps,
        browserConfig,
        configs,
        variables,
        removeConfigNames,
        removeVariableNames
    }: {
        testCaseId: string;
        activeRunResolution?: 'cancel_and_save' | 'do_not_save';
        displayId?: string;
        name?: string;
        url?: string;
        prompt?: string;
        steps?: Array<z.infer<typeof mcpStepSchema>>;
        browserConfig?: Record<string, unknown>;
        configs?: Array<z.infer<typeof mcpConfigSchema>>;
        variables?: Array<z.infer<typeof mcpConfigSchema>>;
        removeConfigNames?: string[];
        removeVariableNames?: string[];
    }, extra: McpHandlerExtra): Promise<ToolResponse> => withToolTelemetry('update_test_case', async () => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const testCase = await prisma.testCase.findUnique({
            where: { id: testCaseId },
            select: { id: true, name: true, status: true }
        });
        if (!testCase) return errorResult('Not found');
        if (!await isTestCaseProjectMember(userId, testCaseId)) return errorResult('Forbidden');

        const changedFields: Array<'displayId' | 'name' | 'url' | 'prompt' | 'steps' | 'browserConfig' | 'configs'> = [];
        if (displayId !== undefined) changedFields.push('displayId');
        if (name !== undefined) changedFields.push('name');
        if (url !== undefined) changedFields.push('url');
        if (prompt !== undefined) changedFields.push('prompt');
        if (steps !== undefined) changedFields.push('steps');
        if (browserConfig !== undefined) changedFields.push('browserConfig');
        if (
            configs !== undefined
            || variables !== undefined
            || removeConfigNames !== undefined
            || removeVariableNames !== undefined
        ) {
            changedFields.push('configs');
        }

        if (changedFields.length === 0) {
            return errorResult('At least one field change is required.', {
                code: 'NO_CHANGES_PROVIDED',
                allowedFields: [
                    'displayId',
                    'name',
                    'url',
                    'prompt',
                    'steps',
                    'browserConfig',
                    'configs',
                    'variables',
                    'removeConfigNames',
                    'removeVariableNames'
                ],
            });
        }

        const activeRuns = await prisma.testRun.findMany({
            where: {
                testCaseId,
                status: { in: [...RUN_ACTIVE_STATUSES] }
            },
            orderBy: { createdAt: 'asc' },
            select: { id: true, status: true, createdAt: true }
        });
        const cancelledRunIds: string[] = [];
        const failedCancellations: Array<{ runId: string; error: string }> = [];

        if (activeRuns.length > 0) {
            if (!activeRunResolution) {
                return errorResult(
                    'Test case has queued/running runs. Confirm whether to cancel them before saving to DRAFT.',
                    {
                        code: 'ACTIVE_RUN_CONFIRMATION_REQUIRED',
                        testCaseId,
                        activeRuns,
                        options: ['cancel_and_save', 'do_not_save'],
                    }
                );
            }

            if (activeRunResolution === 'do_not_save') {
                return textResult({
                    id: testCase.id,
                    name: testCase.name,
                    status: testCase.status,
                    saved: false,
                    skippedReason: 'User chose to keep queued/running runs',
                    activeRuns
                });
            }

            for (const run of activeRuns) {
                try {
                    const cancelled = await cancelRunDurably(run.id, CANCELLATION_REASON.MCP_FOR_UPDATE);
                    if (cancelled) {
                        cancelledRunIds.push(run.id);
                    } else {
                        failedCancellations.push({
                            runId: run.id,
                            error: 'Run is no longer active',
                        });
                    }
                } catch (error) {
                    failedCancellations.push({
                        runId: run.id,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
            }
        }

        const updateData: Record<string, unknown> = {};
        if (displayId !== undefined) updateData.displayId = displayId.trim();
        if (name !== undefined) updateData.name = name;
        if (url !== undefined) updateData.url = url;
        if (prompt !== undefined) updateData.prompt = prompt;
        if (steps !== undefined) {
            updateData.steps = JSON.stringify(cleanStepsForStorage(steps as TestStep[]));
        }
        if (browserConfig !== undefined) {
            updateData.browserConfig = JSON.stringify(normalizeTargetConfigMap(
                browserConfig as Record<string, BrowserConfig | TargetConfig>
            ));
        }
        updateData.status = TEST_STATUS.DRAFT;

        const warnings: string[] = [];
        const upsertConfigInputs = [...(configs ?? []), ...(variables ?? [])];
        const removeConfigInputs = [...(removeConfigNames ?? []), ...(removeVariableNames ?? [])];
        const updateResult = await prisma.$transaction(async (tx) => {
            let removedConfigs = 0;
            let createdConfigs = 0;
            let updatedConfigs = 0;

            const updated = await tx.testCase.update({ where: { id: testCaseId }, data: updateData });

            if (upsertConfigInputs.length > 0 || removeConfigInputs.length > 0) {
                const existingConfigs = await tx.testCaseConfig.findMany({
                    where: { testCaseId },
                    orderBy: { createdAt: 'asc' }
                });
                const existingByName = new Map<string, (typeof existingConfigs)[number]>();
                for (const config of existingConfigs) {
                    existingByName.set(normalizeConfigName(config.name), config);
                }

                const normalizedRemoveNames = new Set<string>();
                for (const rawName of removeConfigInputs) {
                    const nameError = validateConfigName(rawName);
                    if (nameError) {
                        warnings.push(`Remove config "${rawName}": ${nameError}`);
                        continue;
                    }
                    normalizedRemoveNames.add(normalizeConfigName(rawName));
                }

                for (const normalizedName of normalizedRemoveNames) {
                    const existingConfig = existingByName.get(normalizedName);
                    if (!existingConfig) {
                        warnings.push(`Config "${normalizedName}" not found, skipped removal`);
                        continue;
                    }
                    if (existingConfig.type === 'FILE') {
                        warnings.push(`Config "${normalizedName}" skipped removal: FILE config removal is not supported via MCP update_test_case.`);
                        continue;
                    }

                    await tx.testCaseConfig.delete({ where: { id: existingConfig.id } });
                    existingByName.delete(normalizedName);
                    removedConfigs += 1;
                }

                for (const configInput of upsertConfigInputs) {
                    const nameError = validateConfigName(configInput.name);
                    if (nameError) {
                        warnings.push(`Config "${configInput.name}": ${nameError}`);
                        continue;
                    }
                    if (!validateConfigType(configInput.type)) {
                        warnings.push(`Config "${configInput.name}": invalid type "${configInput.type}"`);
                        continue;
                    }

                    const normalizedName = normalizeConfigName(configInput.name);
                    const configType = configInput.type as ConfigType;
                    const configValue = configInput.value ?? '';
                    const valueError = validateConfigValue(configType, configValue);
                    if (valueError) {
                        warnings.push(`Config "${normalizedName}": ${valueError}`);
                        continue;
                    }
                    if (configType === 'FILE') {
                        warnings.push(`Config "${normalizedName}" skipped: FILE upload is not supported in MCP update_test_case.`);
                        continue;
                    }

                    const groupable = isGroupableConfigType(configType);
                    const configData = {
                        name: normalizedName,
                        type: configType,
                        value: configValue,
                        masked: configType === 'VARIABLE' ? (configInput.masked ?? false) : false,
                        group: groupable ? (normalizeConfigGroup(configInput.group) || null) : null,
                    };

                    const existingConfig = existingByName.get(normalizedName);
                    if (existingConfig) {
                        if (existingConfig.type === 'FILE') {
                            warnings.push(`Config "${normalizedName}" skipped update: FILE config updates are not supported via MCP update_test_case.`);
                            continue;
                        }
                        const saved = await tx.testCaseConfig.update({
                            where: { id: existingConfig.id },
                            data: configData
                        });
                        existingByName.set(normalizedName, saved);
                        updatedConfigs += 1;
                    } else {
                        const createdConfig = await tx.testCaseConfig.create({
                            data: {
                                ...configData,
                                testCaseId,
                            }
                        });
                        existingByName.set(normalizedName, createdConfig);
                        createdConfigs += 1;
                    }
                }
            }

            return {
                updated,
                configChanges: {
                    created: createdConfigs,
                    updated: updatedConfigs,
                    removed: removedConfigs,
                }
            };
        });

        return textResult({
            id: updateResult.updated.id,
            name: updateResult.updated.name,
            status: updateResult.updated.status,
            changedFields,
            cancelledRuns: cancelledRunIds,
            failedCancellations,
            configChanges: updateResult.configChanges,
            warnings,
        });
    });

    server.registerTool('update_test_case', {
        description: 'Update one test case per call (displayId, name, steps, browserConfig, url, prompt, and test-case variables/configs)',
        inputSchema: {
            testCaseId: z.string().describe('Test case ID'),
            displayId: z.string().optional().describe('User-facing display ID'),
            name: z.string().optional(),
            url: z.string().optional(),
            prompt: z.string().optional(),
            steps: z.array(mcpStepSchema).optional(),
            browserConfig: z.record(z.string(), z.unknown()).optional(),
            configs: z.array(mcpConfigSchema).optional().describe('Upsert test-case variables/configs'),
            variables: z.array(mcpConfigSchema).optional().describe('Alias of configs (import-style test case variables)'),
            removeConfigNames: z.array(z.string()).optional().describe('Remove test-case configs by name'),
            removeVariableNames: z.array(z.string()).optional().describe('Alias of removeConfigNames'),
            activeRunResolution: z.enum(['cancel_and_save', 'do_not_save']).optional().describe(
                'Required when the test case has active runs. cancel_and_save: cancel queued/running runs and save as DRAFT. do_not_save: keep active runs and skip saving.'
            ),
        },
    }, updateTestCaseHandler);
}

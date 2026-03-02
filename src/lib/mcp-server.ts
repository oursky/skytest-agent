import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { queue } from '@/lib/queue';
import { parseTestCaseJson, cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/test-case-utils';
import { compareByGroupThenName, isGroupableConfigType, normalizeConfigGroup } from '@/lib/config-sort';
import { validateConfigName, normalizeConfigName, validateConfigType } from '@/lib/config-validation';
import { normalizeBrowserConfig } from '@/lib/browser-target';
import { listAndroidDeviceInventory, type AndroidDeviceInventory } from '@/lib/android-devices';
import { ACTIVE_RUN_STATUSES } from '@/utils/statusHelpers';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { TestStep, BrowserConfig, TargetConfig, ConfigType, AndroidDeviceSelector } from '@/types';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function getUserId(extra: Extra): string | null {
    return extra.authInfo?.clientId ?? null;
}

function textResult(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string, details?: unknown) {
    const payload = details === undefined
        ? { error: message }
        : { error: message, details };
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], isError: true as const };
}

async function verifyProjectOwnership(projectId: string, userId: string): Promise<boolean> {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    return project?.userId === userId;
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

interface AndroidDeviceSelectorInput {
    mode: 'emulator-profile' | 'connected-device';
    emulatorProfileName?: string;
    serial?: string;
}

const mcpStepSchema = z.object({
    id: z.string().describe('Step ID (e.g. "step_1")'),
    target: z.string().describe('Target ID (e.g. "browser_a")'),
    action: z.string().describe('Natural language action or verification'),
    type: z.enum(['ai-action', 'playwright-code']).optional().describe('Step type, default ai-action'),
});

const mcpConfigSchema = z.object({
    name: z.string().describe('Variable/config name (UPPER_SNAKE_CASE)'),
    type: z.string().describe('URL | VARIABLE | RANDOM_STRING | APP_ID'),
    value: z.string().optional().describe('Config value'),
    masked: z.boolean().optional().describe('Mask value in UI (VARIABLE type only)'),
    group: z.string().nullable().optional().describe('Group name for organization'),
});

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

function normalizeDeviceLookupValue(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildConnectedDeviceLabel(device: AndroidDeviceInventory['connectedDevices'][number]): string {
    if (device.kind === 'emulator') {
        return device.emulatorProfileName || device.model || device.serial;
    }
    return [device.manufacturer, device.model].filter(Boolean).join(' ').trim() || device.serial;
}

function getUniqueProfileName(matches: ReadonlyArray<AndroidDeviceInventory['emulatorProfiles'][number]>): string | null {
    const profileNames = Array.from(new Set(matches.map((profile) => profile.name)));
    return profileNames.length === 1 ? profileNames[0] : null;
}

function resolveEmulatorProfileName(rawDevice: string, inventory: AndroidDeviceInventory): string | null {
    const trimmed = rawDevice.trim();
    if (!trimmed) {
        return null;
    }

    const lower = trimmed.toLowerCase();
    const normalized = normalizeDeviceLookupValue(trimmed);

    const exactByName = inventory.emulatorProfiles.find((profile) => profile.name === trimmed);
    if (exactByName) {
        return exactByName.name;
    }

    const exactByNameIgnoreCase = getUniqueProfileName(
        inventory.emulatorProfiles.filter((profile) => profile.name.toLowerCase() === lower)
    );
    if (exactByNameIgnoreCase) {
        return exactByNameIgnoreCase;
    }

    const exactByDisplayName = getUniqueProfileName(
        inventory.emulatorProfiles.filter((profile) => profile.displayName.toLowerCase() === lower)
    );
    if (exactByDisplayName) {
        return exactByDisplayName;
    }

    const normalizedMatch = getUniqueProfileName(
        inventory.emulatorProfiles.filter((profile) =>
            normalizeDeviceLookupValue(profile.name) === normalized
            || normalizeDeviceLookupValue(profile.displayName) === normalized
        )
    );
    if (normalizedMatch) {
        return normalizedMatch;
    }

    const prefixMatch = getUniqueProfileName(
        inventory.emulatorProfiles.filter((profile) =>
            profile.name.toLowerCase().startsWith(lower)
            || profile.displayName.toLowerCase().startsWith(lower)
        )
    );
    if (prefixMatch) {
        return prefixMatch;
    }

    return null;
}

function resolveConnectedSerial(rawSerial: string, inventory: AndroidDeviceInventory): string | null {
    const serialLookup = rawSerial.trim().toLowerCase();
    if (!serialLookup) {
        return null;
    }
    const matched = inventory.connectedDevices.find((device) => device.serial.toLowerCase() === serialLookup);
    return matched?.serial ?? null;
}

function resolveConnectedDeviceByAlias(rawDevice: string, inventory: AndroidDeviceInventory): string | null {
    const trimmed = rawDevice.trim();
    if (!trimmed) {
        return null;
    }

    const lower = trimmed.toLowerCase();
    const normalized = normalizeDeviceLookupValue(trimmed);

    const exactLabelMatches = inventory.connectedDevices.filter(
        (device) => buildConnectedDeviceLabel(device).toLowerCase() === lower
    );
    const exactLabelSerials = Array.from(new Set(exactLabelMatches.map((device) => device.serial)));
    if (exactLabelSerials.length === 1) {
        return exactLabelSerials[0];
    }

    const normalizedMatches = inventory.connectedDevices.filter(
        (device) => normalizeDeviceLookupValue(buildConnectedDeviceLabel(device)) === normalized
    );
    const normalizedSerials = Array.from(new Set(normalizedMatches.map((device) => device.serial)));
    if (normalizedSerials.length === 1) {
        return normalizedSerials[0];
    }

    const prefixMatches = inventory.connectedDevices.filter(
        (device) => buildConnectedDeviceLabel(device).toLowerCase().startsWith(lower)
    );
    const prefixSerials = Array.from(new Set(prefixMatches.map((device) => device.serial)));
    if (prefixSerials.length === 1) {
        return prefixSerials[0];
    }

    return null;
}

function resolveAndroidDeviceSelector(
    device?: string,
    selector?: AndroidDeviceSelectorInput,
    inventory?: AndroidDeviceInventory
): AndroidDeviceSelector | null {
    if (selector) {
        if (selector.mode === 'connected-device') {
            const serial = selector.serial?.trim();
            if (serial) {
                const resolvedSerial = inventory ? resolveConnectedSerial(serial, inventory) : null;
                return { mode: 'connected-device', serial: resolvedSerial ?? serial };
            }
            return null;
        }
        const emulatorProfileName = selector.emulatorProfileName?.trim();
        if (emulatorProfileName) {
            const resolvedProfileName = inventory ? resolveEmulatorProfileName(emulatorProfileName, inventory) : null;
            return { mode: 'emulator-profile', emulatorProfileName: resolvedProfileName ?? emulatorProfileName };
        }
        return null;
    }

    const rawDevice = device?.trim();
    if (!rawDevice) {
        return null;
    }
    if (rawDevice.toLowerCase().startsWith('serial:')) {
        const serial = rawDevice.slice('serial:'.length).trim();
        return serial ? { mode: 'connected-device', serial } : null;
    }

    if (inventory) {
        const resolvedSerial = resolveConnectedSerial(rawDevice, inventory);
        if (resolvedSerial) {
            return { mode: 'connected-device', serial: resolvedSerial };
        }

        const resolvedProfileName = resolveEmulatorProfileName(rawDevice, inventory);
        if (resolvedProfileName) {
            return { mode: 'emulator-profile', emulatorProfileName: resolvedProfileName };
        }

        const aliasSerial = resolveConnectedDeviceByAlias(rawDevice, inventory);
        if (aliasSerial) {
            return { mode: 'connected-device', serial: aliasSerial };
        }
    }

    return { mode: 'emulator-profile', emulatorProfileName: rawDevice };
}

export function createMcpServer(): McpServer {
    const server = new McpServer(
        { name: 'skytest-agent', version: '1.0.0' },
        { capabilities: { tools: {} } }
    );

    server.registerTool('list_projects', {
        description: 'List all projects owned by the authenticated user',
    }, async (extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const projects = await prisma.project.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            include: { _count: { select: { testCases: true } } }
        });
        return textResult(projects.map(p => ({
            id: p.id, name: p.name, testCaseCount: p._count.testCases, updatedAt: p.updatedAt
        })));
    });

    server.registerTool('get_project', {
        description: 'Get project details including project-level configs',
        inputSchema: { projectId: z.string().describe('Project ID') },
    }, async ({ projectId }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { _count: { select: { testCases: true } }, configs: true }
        });
        if (!project) return errorResult('Project not found');
        if (project.userId !== userId) return errorResult('Forbidden');
        const configs = project.configs.sort(compareByGroupThenName).map(c => ({
            ...c, value: c.masked ? '' : c.value
        }));
        return textResult({ id: project.id, name: project.name, testCaseCount: project._count.testCases, configs });
    });

    server.registerTool('list_test_cases', {
        description: 'List test cases in a project',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
            status: z.string().optional().describe('Filter by status: DRAFT, PASS, FAIL, etc.'),
            limit: z.number().optional().describe('Max results (default 50, max 100)'),
        },
    }, async ({ projectId, status, limit }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        if (!await verifyProjectOwnership(projectId, userId)) return errorResult('Forbidden');
        const take = Math.max(1, Math.min(limit ?? 50, 100));
        const where: Record<string, unknown> = { projectId };
        if (status) where.status = status;
        const testCases = await prisma.testCase.findMany({
            where, orderBy: { updatedAt: 'desc' }, take,
            select: { id: true, displayId: true, status: true, name: true, source: true, updatedAt: true }
        });
        return textResult(testCases);
    });

    server.registerTool('get_test_case', {
        description: 'Get full test case details: steps, configs, and last 5 runs',
        inputSchema: { testCaseId: z.string().describe('Test case ID') },
    }, async ({ testCaseId }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const tc = await prisma.testCase.findUnique({
            where: { id: testCaseId },
            include: {
                project: { select: { userId: true } },
                configs: true,
                testRuns: { take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, error: true, createdAt: true, completedAt: true } }
            }
        });
        if (!tc) return errorResult('Not found');
        if (tc.project.userId !== userId) return errorResult('Forbidden');
        const { project, configs, testRuns, ...tcData } = tc;
        void project;
        const parsed = parseTestCaseJson(tcData);
        const sortedConfigs = configs.sort(compareByGroupThenName).map(c => ({
            ...c, value: c.masked ? '' : c.value
        }));
        return textResult({ ...parsed, configs: sortedConfigs, testRuns });
    });

    const createTestCaseInputSchema = {
        projectId: z.string().describe('Project ID'),
        testCase: mcpCreateTestCaseSchema.describe('Test case to create'),
    };
    const createTestCaseHandler = async ({ projectId, testCase }: { projectId: string; testCase: McpCreateTestCaseInput }, extra: Extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        if (!await verifyProjectOwnership(projectId, userId)) return errorResult('Forbidden');

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
            ? await listAndroidDeviceInventory()
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
                            (p) => p.name === deviceSelector.emulatorProfileName
                        );
                    } else if (deviceSelector.mode === 'connected-device') {
                        deviceLabel = target.device || deviceSelector.serial;
                        foundInInventory = androidInventory.connectedDevices.some(
                            (d) => d.serial === deviceSelector.serial
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

        const created = await prisma.testCase.create({
            data: {
                name,
                url: normalizedUrl,
                prompt: testCase.prompt,
                steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
                browserConfig: normalizedBrowserConfig ? JSON.stringify(normalizedBrowserConfig) : undefined,
                projectId,
                displayId,
                status: 'DRAFT',
                source: 'agent',
            },
        });

        let createdTestCaseVariableCount = 0;

        const testCaseVariables = [...(testCase.configs || []), ...(testCase.variables || [])];
        if (testCaseVariables.length > 0) {
            const projectConfigs = await prisma.projectConfig.findMany({ where: { projectId } });

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
                if (configType === 'FILE') {
                    warnings.push(`Config "${normalizedName}" skipped: FILE upload is not supported in MCP create_test_case.`);
                    continue;
                }

                const projectConfigWithSameName = projectConfigs.find(
                    (pc) => normalizeConfigName(pc.name) === normalizedName && pc.type === configType
                );
                if (configValue.length === 0 && projectConfigWithSameName) {
                    warnings.push(
                        `Config "${normalizedName}" skipped: empty test-case value would override project config "${projectConfigWithSameName.name}".`
                    );
                    continue;
                }

                const matchingProjectConfig = projectConfigs.find(
                    pc => pc.value === configValue && pc.type === configType
                );
                if (matchingProjectConfig) {
                    warnings.push(`Config "${normalizedName}" skipped: project variable "${matchingProjectConfig.name}" already has the same value — use it instead`);
                    continue;
                }

                const groupable = isGroupableConfigType(configType);

                try {
                    await prisma.testCaseConfig.create({
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

        return textResult({
            id: created.id,
            name: created.name,
            displayId: created.displayId,
            createdTargets: normalizedBrowserConfig ? Object.keys(normalizedBrowserConfig).length : 0,
            createdTestCaseVariables: createdTestCaseVariableCount,
            warnings
        });
    };

    server.registerTool('create_test_case', {
        description: 'Create exactly one test case per call with import-equivalent details (ID, targets, steps, test-case variables). FILE uploads are not supported via MCP.',
        inputSchema: createTestCaseInputSchema,
    }, createTestCaseHandler);

    server.registerTool('update_test_case', {
        description: 'Update one test case per call (name, steps, browserConfig, url, prompt, and test-case variables/configs)',
        inputSchema: {
            testCaseId: z.string().describe('Test case ID'),
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
    }, async ({
        testCaseId,
        activeRunResolution,
        name,
        url,
        prompt,
        steps,
        browserConfig,
        configs,
        variables,
        removeConfigNames,
        removeVariableNames
    }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const tc = await prisma.testCase.findUnique({
            where: { id: testCaseId },
            include: { project: { select: { userId: true } } }
        });
        if (!tc) return errorResult('Not found');
        if (tc.project.userId !== userId) return errorResult('Forbidden');

        const changedFields: Array<'name' | 'url' | 'prompt' | 'steps' | 'browserConfig' | 'configs'> = [];
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
                status: { in: [...ACTIVE_RUN_STATUSES] }
            },
            orderBy: { createdAt: 'asc' },
            select: { id: true, status: true, createdAt: true }
        });

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
                    id: tc.id,
                    name: tc.name,
                    status: tc.status,
                    saved: false,
                    skippedReason: 'User chose to keep queued/running runs',
                    activeRuns
                });
            }

            for (const run of activeRuns) {
                await queue.cancel(run.id, 'Cancelled to allow MCP test case update');
            }
        }

        const updateData: Record<string, unknown> = {};
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
        updateData.status = 'DRAFT';

        const warnings: string[] = [];
        const upsertConfigInputs = [...(configs ?? []), ...(variables ?? [])];
        const removeConfigInputs = [...(removeConfigNames ?? []), ...(removeVariableNames ?? [])];
        let removedConfigs = 0;
        let createdConfigs = 0;
        let updatedConfigs = 0;

        const updated = await prisma.testCase.update({ where: { id: testCaseId }, data: updateData });

        if (upsertConfigInputs.length > 0 || removeConfigInputs.length > 0) {
            const existingConfigs = await prisma.testCaseConfig.findMany({
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

                await prisma.testCaseConfig.delete({ where: { id: existingConfig.id } });
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
                if (configType === 'FILE') {
                    warnings.push(`Config "${normalizedName}" skipped: FILE upload is not supported in MCP update_test_case.`);
                    continue;
                }

                const groupable = isGroupableConfigType(configType);
                const data = {
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
                    const saved = await prisma.testCaseConfig.update({
                        where: { id: existingConfig.id },
                        data
                    });
                    existingByName.set(normalizedName, saved);
                    updatedConfigs += 1;
                } else {
                    const createdConfig = await prisma.testCaseConfig.create({
                        data: {
                            ...data,
                            testCaseId,
                        }
                    });
                    existingByName.set(normalizedName, createdConfig);
                    createdConfigs += 1;
                }
            }
        }

        return textResult({
            id: updated.id,
            name: updated.name,
            status: updated.status,
            changedFields,
            cancelledRuns: activeRuns.map((run) => run.id),
            configChanges: {
                created: createdConfigs,
                updated: updatedConfigs,
                removed: removedConfigs,
            },
            warnings,
        });
    });

    server.registerTool('stop_all_runs', {
        description: 'Cancel all queued/preparing/running test runs for one project owned by the authenticated user.',
        inputSchema: {
            projectId: z.string().describe('Project ID to scope cancellations'),
            reason: z.string().optional().describe('Optional cancellation reason shown in run errors'),
        },
    }, async ({ projectId, reason }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        if (!await verifyProjectOwnership(projectId, userId)) return errorResult('Forbidden');

        const where = {
            status: { in: [...ACTIVE_RUN_STATUSES] },
            testCase: { projectId, project: { userId } },
        };

        const activeRuns = await prisma.testRun.findMany({
            where,
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                status: true,
            }
        });

        const statusSummary: Record<string, number> = {};
        for (const run of activeRuns) {
            statusSummary[run.status] = (statusSummary[run.status] || 0) + 1;
        }

        if (activeRuns.length === 0) {
            return textResult({
                projectId,
                requestedActiveRuns: 0,
                cancelledRuns: 0,
                failedCancellations: 0,
                statusSummary,
            });
        }

        const cancelledRunIds: string[] = [];
        const failures: Array<{ runId: string; error: string }> = [];
        const cancellationReason = reason?.trim() || 'Cancelled by MCP stop_all_runs';

        for (const run of activeRuns) {
            try {
                await queue.cancel(run.id, cancellationReason);
                cancelledRunIds.push(run.id);
            } catch (error) {
                failures.push({
                    runId: run.id,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        return textResult({
            projectId,
            requestedActiveRuns: activeRuns.length,
            cancelledRuns: cancelledRunIds.length,
            failedCancellations: failures.length,
            cancelledRunIds,
            failures,
            statusSummary,
        });
    });

    server.registerTool('stop_all_queues', {
        description: 'Cancel all queued test runs (status QUEUED only) for one project owned by the authenticated user.',
        inputSchema: {
            projectId: z.string().describe('Project ID to scope cancellations'),
            reason: z.string().optional().describe('Optional cancellation reason shown in run errors'),
        },
    }, async ({ projectId, reason }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        if (!await verifyProjectOwnership(projectId, userId)) return errorResult('Forbidden');

        const where = {
            status: 'QUEUED' as const,
            testCase: { projectId, project: { userId } },
        };

        const queuedRuns = await prisma.testRun.findMany({
            where,
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                status: true,
            }
        });

        const statusSummary: Record<string, number> = {};
        for (const run of queuedRuns) {
            statusSummary[run.status] = (statusSummary[run.status] || 0) + 1;
        }

        if (queuedRuns.length === 0) {
            return textResult({
                projectId,
                requestedQueuedRuns: 0,
                cancelledRuns: 0,
                failedCancellations: 0,
                statusSummary,
            });
        }

        const cancelledRunIds: string[] = [];
        const failures: Array<{ runId: string; error: string }> = [];
        const cancellationReason = reason?.trim() || 'Cancelled by MCP stop_all_queues';

        for (const run of queuedRuns) {
            try {
                await queue.cancel(run.id, cancellationReason);
                cancelledRunIds.push(run.id);
            } catch (error) {
                failures.push({
                    runId: run.id,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        return textResult({
            projectId,
            requestedQueuedRuns: queuedRuns.length,
            cancelledRuns: cancelledRunIds.length,
            failedCancellations: failures.length,
            cancelledRunIds,
            failures,
            statusSummary,
        });
    });

    server.registerTool('delete_test_case', {
        description: 'Delete a test case and all its runs, files, and configs',
        inputSchema: { testCaseId: z.string().describe('Test case ID') },
    }, async ({ testCaseId }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const tc = await prisma.testCase.findUnique({
            where: { id: testCaseId },
            include: { project: { select: { userId: true } } }
        });
        if (!tc) return errorResult('Not found');
        if (tc.project.userId !== userId) return errorResult('Forbidden');
        await prisma.testCase.delete({ where: { id: testCaseId } });
        return textResult({ success: true });
    });

    server.registerTool('get_test_run', {
        description: 'Get test run status and result summary',
        inputSchema: { runId: z.string().describe('Test run ID') },
    }, async ({ runId }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const run = await prisma.testRun.findUnique({
            where: { id: runId },
            include: { testCase: { include: { project: { select: { userId: true } } } } }
        });
        if (!run) return errorResult('Not found');
        if (run.testCase.project.userId !== userId) return errorResult('Forbidden');
        return textResult({
            id: run.id, status: run.status, error: run.error,
            startedAt: run.startedAt, completedAt: run.completedAt, createdAt: run.createdAt
        });
    });

    server.registerTool('get_project_test_summary', {
        description: 'Get status breakdown of all test cases in a project',
        inputSchema: { projectId: z.string().describe('Project ID') },
    }, async ({ projectId }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        if (!await verifyProjectOwnership(projectId, userId)) return errorResult('Forbidden');
        const testCases = await prisma.testCase.findMany({
            where: { projectId }, select: { status: true }
        });
        const summary: Record<string, number> = {};
        for (const tc of testCases) {
            summary[tc.status] = (summary[tc.status] || 0) + 1;
        }
        return textResult({ total: testCases.length, byStatus: summary });
    });

    return server;
}

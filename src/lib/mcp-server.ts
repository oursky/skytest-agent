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

    server.registerTool('create_test_cases', {
        description: 'Create exactly one test case per call with import-equivalent details (ID, targets, steps, test-case variables). FILE uploads are not supported via MCP.',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
            testCase: z.object({
                name: z.string().optional().describe('Test case name'),
                displayId: z.string().optional().describe('User-facing display ID'),
                testCaseId: z.string().optional().describe('Alias of displayId (import format)'),
                url: z.string().optional().describe('Base URL for browser target'),
                prompt: z.string().optional().describe('AI prompt (alternative to steps)'),
                steps: z.array(z.object({
                    id: z.string().describe('Step ID (e.g. "step_1")'),
                    target: z.string().describe('Target ID (e.g. "browser_a")'),
                    action: z.string().describe('Natural language action or verification'),
                    type: z.enum(['ai-action', 'playwright-code']).optional().describe('Step type, default ai-action'),
                })).optional().describe('Test steps'),
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
                configs: z.array(z.object({
                    name: z.string().describe('Variable/config name (UPPER_SNAKE_CASE)'),
                    type: z.string().describe('URL | VARIABLE | RANDOM_STRING | FILE | APP_ID'),
                    value: z.string().optional().describe('Config value'),
                    masked: z.boolean().optional().describe('Mask value in UI (VARIABLE type only)'),
                    group: z.string().nullable().optional().describe('Group name for organization'),
                })).optional().describe('Test case variables/configs'),
                variables: z.array(z.object({
                    name: z.string().describe('Config name (UPPER_SNAKE_CASE)'),
                    type: z.string().describe('URL | VARIABLE | RANDOM_STRING | FILE | APP_ID'),
                    value: z.string().optional().describe('Config value'),
                    masked: z.boolean().optional().describe('Mask value in UI (VARIABLE type only)'),
                    group: z.string().nullable().optional().describe('Group name for organization'),
                })).optional().describe('Alias of configs (import-style test case variables)'),
            }).describe('Test case to create'),
        },
    }, async ({ projectId, testCase }, extra) => {
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
                if (configType === 'FILE') {
                    warnings.push(`Config "${normalizedName}" skipped: FILE upload is not supported in MCP create_test_cases.`);
                    continue;
                }

                const matchingProjectConfig = projectConfigs.find(
                    pc => pc.value === (configInput.value || '') && pc.type === configType
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
                            value: configInput.value || '',
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
    });

    server.registerTool('update_test_case', {
        description: 'Update a test case (name, steps, browserConfig, url, prompt)',
        inputSchema: {
            testCaseId: z.string().describe('Test case ID'),
            name: z.string().optional(),
            url: z.string().optional(),
            prompt: z.string().optional(),
            steps: z.array(z.object({
                id: z.string(), target: z.string(), action: z.string(),
                type: z.enum(['ai-action', 'playwright-code']).optional(),
            })).optional(),
            browserConfig: z.record(z.string(), z.unknown()).optional(),
            activeRunResolution: z.enum(['cancel_and_save', 'do_not_save']).optional().describe(
                'Required when the test case has active runs. cancel_and_save: cancel queued/running runs and save as DRAFT. do_not_save: keep active runs and skip saving.'
            ),
        },
    }, async ({ testCaseId, activeRunResolution, ...updates }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const tc = await prisma.testCase.findUnique({
            where: { id: testCaseId },
            include: { project: { select: { userId: true } } }
        });
        if (!tc) return errorResult('Not found');
        if (tc.project.userId !== userId) return errorResult('Forbidden');

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
        if (updates.name !== undefined) updateData.name = updates.name;
        if (updates.url !== undefined) updateData.url = updates.url;
        if (updates.prompt !== undefined) updateData.prompt = updates.prompt;
        if (updates.steps) {
            updateData.steps = JSON.stringify(cleanStepsForStorage(updates.steps));
        }
        if (updates.browserConfig) {
            updateData.browserConfig = JSON.stringify(
                normalizeTargetConfigMap(updates.browserConfig as Record<string, import('@/types').BrowserConfig | import('@/types').TargetConfig>)
            );
        }
        updateData.status = 'DRAFT';

        const updated = await prisma.testCase.update({ where: { id: testCaseId }, data: updateData });
        return textResult({
            id: updated.id,
            name: updated.name,
            status: updated.status,
            cancelledRuns: activeRuns.map((run) => run.id)
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

    server.registerTool('run_test', {
        description: 'Not yet implemented via MCP. Use the REST API POST /api/run-test directly.',
        inputSchema: { testCaseId: z.string().describe('Test case ID') },
    }, async ({ testCaseId }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        void testCaseId;
        return errorResult('run_test via MCP is not yet implemented. Use the REST API POST /api/run-test directly.');
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

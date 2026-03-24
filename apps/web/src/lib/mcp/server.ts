import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prisma } from '@/lib/core/prisma';
import { parseTestCaseJson, cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import { compareByGroupThenName, isGroupableConfigType, normalizeConfigGroup } from '@/lib/test-config/sort';
import { validateConfigName, normalizeConfigName, validateConfigType } from '@/lib/test-config/validation';
import { normalizeBrowserConfig } from '@/lib/test-config/browser-target';
import { resolveAndroidDeviceSelector, type AndroidDeviceSelectorInventory } from '@/lib/mcp/android-selector';
import { cancelRunDurably } from '@/lib/mcp/run-cancellation';
import { deleteObjectKeysBestEffort } from '@/lib/mcp/storage-cleanup';
import { queueTestCaseRun } from '@/lib/mcp/run-execution';
import { listTestRuns } from '@/lib/mcp/run-query';
import { manageProjectConfigs } from '@/lib/mcp/project-config-manager';
import { getProjectRunnerInventory } from '@/lib/mcp/runner-inventory';
import { createLogger } from '@/lib/core/logger';
import {
    RUN_ACTIVE_STATUSES,
    TEST_STATUS,
    type TestStep,
    type BrowserConfig,
    type TargetConfig,
    type ConfigType,
} from '@/types';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { isProjectMember, isTestCaseProjectMember, isTestRunProjectMember } from '@/lib/security/permissions';
import {
    resolveProjectForbiddenOrNotFound,
    resolveTestCaseForbiddenOrNotFound,
} from '@/lib/security/resource-access-errors';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
const mcpToolLogger = createLogger('mcp:tool');

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

type ToolResponse = ReturnType<typeof textResult> | ReturnType<typeof errorResult>;

function calculateToolResponseBytes(result: ToolResponse): number {
    return result.content.reduce((sum, entry) => sum + entry.text.length, 0);
}

// Telemetry is intentionally applied to the highest-volume MCP tools first to
// keep overhead low while preserving hotspot visibility for performance work.
async function withToolTelemetry(
    toolName: string,
    handler: () => Promise<ToolResponse>
): Promise<ToolResponse> {
    const startedAtMs = Date.now();
    try {
        const result = await handler();
        mcpToolLogger.debug('MCP tool handled', {
            toolName,
            elapsedMs: Date.now() - startedAtMs,
            responseBytes: calculateToolResponseBytes(result),
            isError: 'isError' in result && result.isError === true,
        });
        return result;
    } catch (error) {
        mcpToolLogger.warn('MCP tool failed', {
            toolName,
            elapsedMs: Date.now() - startedAtMs,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}

async function verifyProjectAccess(projectId: string, userId: string): Promise<boolean> {
    return isProjectMember(userId, projectId);
}

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
    group: z.string().nullable().optional().describe('Group name for team'),
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

const mcpRunOverridesSchema = z.object({
    url: z.string().optional().describe('Override URL for this run'),
    prompt: z.string().optional().describe('Override prompt for this run'),
    steps: z.array(mcpStepSchema).optional().describe('Override steps for this run'),
    browserConfig: z.record(z.string(), z.unknown()).optional().describe('Override browser/android target config for this run'),
    requestedDeviceId: z.string().optional().describe('Optional explicit requested device id for Android runs'),
    requestedRunnerId: z.string().optional().describe('Optional explicit requested runner id for Android runs'),
});

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
            where: { team: { memberships: { some: { userId } } } },
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
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                team: {
                    memberships: {
                        some: { userId },
                    },
                },
            },
            include: { _count: { select: { testCases: true } }, configs: true }
        });
        if (!project) {
            const accessError = await resolveProjectForbiddenOrNotFound(projectId);
            return errorResult(accessError.message);
        }
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
        const take = Math.max(1, Math.min(limit ?? 50, 100));

        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                team: {
                    memberships: {
                        some: { userId },
                    },
                },
            },
            select: {
                testCases: {
                    where: status ? { status } : undefined,
                    orderBy: { updatedAt: 'desc' },
                    take,
                    select: { id: true, displayId: true, status: true, name: true, source: true, updatedAt: true },
                },
            },
        });

        if (!project) {
            const accessError = await resolveProjectForbiddenOrNotFound(projectId);
            return errorResult(accessError.message);
        }

        return textResult(project.testCases);
    });

    server.registerTool('get_test_case', {
        description: 'Get full test case details: steps, configs, and last 5 runs',
        inputSchema: { testCaseId: z.string().describe('Test case ID') },
    }, async ({ testCaseId }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const tc = await prisma.testCase.findFirst({
            where: {
                id: testCaseId,
                project: {
                    team: {
                        memberships: {
                            some: { userId },
                        },
                    },
                },
            },
            include: {
                configs: true,
                testRuns: { take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, error: true, createdAt: true, completedAt: true } }
            }
        });
        if (!tc) {
            const accessError = await resolveTestCaseForbiddenOrNotFound(testCaseId);
            return errorResult(accessError.message);
        }
        const { configs, testRuns, ...tcData } = tc;
        const parsed = parseTestCaseJson(tcData);
        const sortedConfigs = configs.sort(compareByGroupThenName).map(c => ({
            ...c, value: c.masked ? '' : c.value
        }));
        return textResult({ ...parsed, configs: sortedConfigs, testRuns });
    });

    server.registerTool('run_test_case', {
        description: 'Queue one test run for a test case with optional per-run overrides.',
        inputSchema: {
            testCaseId: z.string().describe('Test case ID'),
            overrides: mcpRunOverridesSchema.optional().describe('Optional runtime overrides'),
        },
    }, async ({ testCaseId, overrides }, extra) => withToolTelemetry('run_test_case', async () => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        try {
            const runResult = await queueTestCaseRun(userId, testCaseId, overrides ? {
                url: overrides.url,
                prompt: overrides.prompt,
                steps: overrides.steps as TestStep[] | undefined,
                browserConfig: overrides.browserConfig as Record<string, BrowserConfig | TargetConfig> | undefined,
                requestedDeviceId: overrides.requestedDeviceId,
                requestedRunnerId: overrides.requestedRunnerId,
            } : undefined);

            if (!runResult.ok) {
                return errorResult(runResult.failure.error, runResult.failure.details);
            }

            return textResult(runResult.data);
        } catch {
            return errorResult('Failed to queue test run');
        }
    }));

    server.registerTool('list_test_runs', {
        description: 'List test runs with filters and optional included events/artifacts.',
        inputSchema: {
            projectId: z.string().optional().describe('Optional project ID filter'),
            testCaseId: z.string().optional().describe('Optional test case ID filter'),
            status: z.string().optional().describe('Optional run status filter'),
            from: z.string().optional().describe('Optional ISO datetime lower bound for createdAt'),
            to: z.string().optional().describe('Optional ISO datetime upper bound for createdAt'),
            limit: z.number().optional().describe('Result size per page (default 20, max 50)'),
            cursor: z.string().optional().describe('Pagination cursor (previous response nextCursor)'),
            include: z.array(z.enum(['events', 'artifacts'])).optional().describe('Optional expansions'),
        },
    }, async ({ projectId, testCaseId, status, from, to, limit, cursor, include }, extra) => withToolTelemetry('list_test_runs', async () => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        try {
            const listResult = await listTestRuns(userId, {
                projectId,
                testCaseId,
                status,
                from,
                to,
                limit,
                cursor,
                include,
            });

            if (!listResult.ok) {
                return errorResult(listResult.failure.error, listResult.failure.details);
            }

            return textResult(listResult.data);
        } catch {
            return errorResult('Failed to list test runs');
        }
    }));

    server.registerTool('manage_project_configs', {
        description: 'Upsert and remove project-level configs in one call. FILE uploads are not supported via MCP.',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
            upsert: z.array(mcpConfigSchema).optional().describe('Configs to create or update by normalized name'),
            remove: z.array(z.string()).optional().describe('Config names to remove'),
        },
    }, async ({ projectId, upsert, remove }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        if (!await verifyProjectAccess(projectId, userId)) return errorResult('Forbidden');

        if ((!upsert || upsert.length === 0) && (!remove || remove.length === 0)) {
            return errorResult('At least one upsert or remove change is required.', {
                code: 'NO_CHANGES_PROVIDED',
                allowedFields: ['upsert', 'remove'],
            });
        }

        try {
            const result = await manageProjectConfigs({
                projectId,
                upsert: upsert ?? [],
                remove: remove ?? [],
            });

            return textResult(result);
        } catch {
            return errorResult('Failed to manage project configs');
        }
    });

    server.registerTool('list_runner_inventory', {
        description: 'List team runner and Android device inventory scoped by project.',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
        },
    }, async ({ projectId }, extra) => withToolTelemetry('list_runner_inventory', async () => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        if (!await verifyProjectAccess(projectId, userId)) return errorResult('Forbidden');

        try {
            const inventory = await getProjectRunnerInventory(projectId);
            if (!inventory) {
                return errorResult('Project not found');
            }

            return textResult(inventory);
        } catch {
            return errorResult('Failed to list runner inventory');
        }
    }));

    const createTestCaseInputSchema = {
        projectId: z.string().describe('Project ID'),
        testCase: mcpCreateTestCaseSchema.describe('Test case to create'),
    };
    const createTestCaseHandler = async ({ projectId, testCase }: { projectId: string; testCase: McpCreateTestCaseInput }, extra: Extra) => {
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
                    source: 'agent',
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
            select: { id: true, name: true, status: true }
        });
        if (!tc) return errorResult('Not found');
        if (!await isTestCaseProjectMember(userId, testCaseId)) return errorResult('Forbidden');

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
                    id: tc.id,
                    name: tc.name,
                    status: tc.status,
                    saved: false,
                    skippedReason: 'User chose to keep queued/running runs',
                    activeRuns
                });
            }

            for (const run of activeRuns) {
                try {
                    const cancelled = await cancelRunDurably(run.id, 'Cancelled to allow MCP test case update');
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
                        const saved = await tx.testCaseConfig.update({
                            where: { id: existingConfig.id },
                            data
                        });
                        existingByName.set(normalizedName, saved);
                        updatedConfigs += 1;
                    } else {
                        const createdConfig = await tx.testCaseConfig.create({
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

    server.registerTool('stop_all_runs', {
        description: 'Cancel all queued/preparing/running test runs for one project owned by the authenticated user.',
        inputSchema: {
            projectId: z.string().describe('Project ID to scope cancellations'),
            reason: z.string().optional().describe('Optional cancellation reason shown in run errors'),
        },
    }, async ({ projectId, reason }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        if (!await verifyProjectAccess(projectId, userId)) return errorResult('Forbidden');

        const where = {
            status: { in: [...RUN_ACTIVE_STATUSES] },
            testCase: { projectId },
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
        const skippedCancellations: Array<{ runId: string; reason: string }> = [];
        const cancellationReason = reason?.trim() || 'Cancelled by MCP stop_all_runs';

        for (const run of activeRuns) {
            try {
                const cancelled = await cancelRunDurably(run.id, cancellationReason);
                if (cancelled) {
                    cancelledRunIds.push(run.id);
                } else {
                    skippedCancellations.push({
                        runId: run.id,
                        reason: 'Run is no longer active',
                    });
                }
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
            skippedCancellations: skippedCancellations.length,
            cancelledRunIds,
            skipped: skippedCancellations,
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
        if (!await verifyProjectAccess(projectId, userId)) return errorResult('Forbidden');

        const where = {
            status: TEST_STATUS.QUEUED,
            testCase: { projectId },
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
        const skippedCancellations: Array<{ runId: string; reason: string }> = [];
        const cancellationReason = reason?.trim() || 'Cancelled by MCP stop_all_queues';

        for (const run of queuedRuns) {
            try {
                const cancelled = await cancelRunDurably(run.id, cancellationReason);
                if (cancelled) {
                    cancelledRunIds.push(run.id);
                } else {
                    skippedCancellations.push({
                        runId: run.id,
                        reason: 'Run is no longer active',
                    });
                }
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
            skippedCancellations: skippedCancellations.length,
            cancelledRunIds,
            skipped: skippedCancellations,
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
            select: {
                id: true,
                projectId: true,
                files: {
                    select: { storedName: true }
                },
                configs: {
                    where: { type: 'FILE' },
                    select: { value: true }
                }
            }
        });
        if (!tc) return errorResult('Not found');
        if (!await verifyProjectAccess(tc.projectId, userId)) return errorResult('Forbidden');

        const objectKeys = [
            ...tc.files.map((file) => file.storedName),
            ...tc.configs.map((config) => config.value),
        ];

        await prisma.testCase.delete({ where: { id: testCaseId } });
        const cleanupResult = await deleteObjectKeysBestEffort(objectKeys);
        return textResult({
            success: true,
            deletedObjectCount: cleanupResult.deletedObjectCount,
            failedObjectKeys: cleanupResult.failedObjectKeys,
        });
    });

    server.registerTool('get_test_run', {
        description: 'Get test run status and result summary',
        inputSchema: { runId: z.string().describe('Test run ID') },
    }, async ({ runId }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const run = await prisma.testRun.findUnique({
            where: { id: runId },
            select: {
                id: true,
                status: true,
                error: true,
                startedAt: true,
                completedAt: true,
                createdAt: true,
            }
        });
        if (!run) return errorResult('Not found');
        if (!await isTestRunProjectMember(userId, runId)) return errorResult('Forbidden');
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
        if (!await verifyProjectAccess(projectId, userId)) return errorResult('Forbidden');
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

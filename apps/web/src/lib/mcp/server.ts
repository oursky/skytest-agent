import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prisma } from '@/lib/core/prisma';
import { parseTestCaseJson } from '@/lib/runtime/test-case-utils';
import { compareByGroupThenName } from '@/lib/test-config/sort';
import { cancelRunDurably } from '@/lib/mcp/run-cancellation';
import { deleteObjectKeysBestEffort } from '@/lib/mcp/storage-cleanup';
import { queueTestCaseRun } from '@/lib/mcp/run-execution';
import { listTestRuns } from '@/lib/mcp/run-query';
import { manageProjectConfigs } from '@/lib/mcp/project-config-manager';
import { getProjectRunnerInventory } from '@/lib/mcp/runner-inventory';
import { registerTestCaseMutationTools } from '@/lib/mcp/test-case-mutation-tools';
import { createLogger } from '@/lib/core/logger';
import {
    RUN_ACTIVE_STATUSES,
    TEST_STATUS,
    type TestStep,
    type BrowserConfig,
    type TargetConfig,
} from '@/types';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { isProjectMember, isTestRunProjectMember } from '@/lib/security/permissions';
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

    registerTestCaseMutationTools(server);

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

import { prisma } from '@/lib/core/prisma';
import { parseTestCaseJson } from '@/lib/runtime/test-case-utils';
import { compareByGroupThenName } from '@/lib/test-config/sort';
import { cancelRunDurably } from '@/lib/mcp/run-cancellation';
import { deleteObjectKeysBestEffort } from '@/lib/mcp/storage-cleanup';
import { queueTestCaseRun } from '@/lib/mcp/run-execution';
import { listTestRuns } from '@/lib/mcp/run-query';
import { manageProjectConfigs } from '@/lib/mcp/project-config-manager';
import { getProjectRunnerInventory } from '@/lib/mcp/runner-inventory';
import { getUserId, type McpHandlerExtra, verifyProjectAccess } from '@/lib/mcp/server-auth';
import { errorResult, textResult, withToolTelemetry, type ToolResponse } from '@/lib/mcp/server-response';
import type { McpRunOverridesInput } from '@/lib/mcp/server-schemas';
import {
    RUN_ACTIVE_STATUSES,
    TEST_STATUS,
    type TestStep,
    type BrowserConfig,
    type TargetConfig,
} from '@/types';
import { isTestRunProjectMember } from '@/lib/security/permissions';
import {
    resolveProjectForbiddenOrNotFound,
    resolveTestCaseForbiddenOrNotFound,
} from '@/lib/security/resource-access-errors';

export async function listProjectsTool(extra: McpHandlerExtra): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');

    const projects = await prisma.project.findMany({
        where: { team: { memberships: { some: { userId } } } },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { testCases: true } } }
    });

    return textResult(projects.map((project) => ({
        id: project.id,
        name: project.name,
        testCaseCount: project._count.testCases,
        updatedAt: project.updatedAt,
    })));
}

export async function getProjectTool(
    { projectId }: { projectId: string },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');

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

    if (project === null) {
        const accessError = await resolveProjectForbiddenOrNotFound(projectId);
        return errorResult(accessError.message);
    }

    const configs = project.configs.sort(compareByGroupThenName).map((config) => ({
        ...config,
        value: config.masked ? '' : config.value
    }));

    return textResult({
        id: project.id,
        name: project.name,
        testCaseCount: project._count.testCases,
        configs,
    });
}

export async function listTestCasesTool(
    {
        projectId,
        status,
        limit,
    }: { projectId: string; status?: string; limit?: number },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');

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
                select: {
                    id: true,
                    displayId: true,
                    status: true,
                    name: true,
                    source: true,
                    updatedAt: true,
                },
            },
        },
    });

    if (project === null) {
        const accessError = await resolveProjectForbiddenOrNotFound(projectId);
        return errorResult(accessError.message);
    }

    return textResult(project.testCases);
}

export async function getTestCaseTool(
    { testCaseId }: { testCaseId: string },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');

    const testCase = await prisma.testCase.findFirst({
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
            testRuns: {
                take: 5,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    status: true,
                    error: true,
                    createdAt: true,
                    completedAt: true,
                },
            }
        }
    });

    if (testCase === null) {
        const accessError = await resolveTestCaseForbiddenOrNotFound(testCaseId);
        return errorResult(accessError.message);
    }

    const { configs, testRuns, ...testCaseData } = testCase;
    const parsedTestCase = parseTestCaseJson(testCaseData);
    const sortedConfigs = configs.sort(compareByGroupThenName).map((config) => ({
        ...config,
        value: config.masked ? '' : config.value
    }));

    return textResult({
        ...parsedTestCase,
        configs: sortedConfigs,
        testRuns,
    });
}

export async function runTestCaseTool(
    {
        testCaseId,
        overrides,
    }: { testCaseId: string; overrides?: McpRunOverridesInput },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    return withToolTelemetry('run_test_case', async () => {
        const userId = getUserId(extra);
        if (userId === null) return errorResult('Unauthorized');

        try {
            const runResult = await queueTestCaseRun(userId, testCaseId, overrides ? {
                url: overrides.url,
                prompt: overrides.prompt,
                steps: overrides.steps as TestStep[] | undefined,
                browserConfig: overrides.browserConfig as Record<string, BrowserConfig | TargetConfig> | undefined,
                requestedDeviceId: overrides.requestedDeviceId,
                requestedRunnerId: overrides.requestedRunnerId,
            } : undefined);

            if (runResult.ok === false) {
                return errorResult(runResult.failure.error, runResult.failure.details);
            }

            return textResult(runResult.data);
        } catch {
            return errorResult('Failed to queue test run');
        }
    });
}

export async function listTestRunsTool(
    {
        projectId,
        testCaseId,
        status,
        from,
        to,
        limit,
        cursor,
        include,
    }: {
        projectId?: string;
        testCaseId?: string;
        status?: string;
        from?: string;
        to?: string;
        limit?: number;
        cursor?: string;
        include?: Array<'events' | 'artifacts'>;
    },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    return withToolTelemetry('list_test_runs', async () => {
        const userId = getUserId(extra);
        if (userId === null) return errorResult('Unauthorized');

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

            if (listResult.ok === false) {
                return errorResult(listResult.failure.error, listResult.failure.details);
            }

            return textResult(listResult.data);
        } catch {
            return errorResult('Failed to list test runs');
        }
    });
}

type ManageProjectConfigsInput = {
    projectId: string;
    upsert?: Array<{
        name: string;
        type: string;
        value?: string;
        masked?: boolean;
        group?: string | null;
    }>;
    remove?: string[];
};

export async function manageProjectConfigsTool(
    {
        projectId,
        upsert,
        remove,
    }: ManageProjectConfigsInput,
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');
    const hasProjectAccess = await verifyProjectAccess(projectId, userId);
    if (hasProjectAccess === false) return errorResult('Forbidden');

    const hasUpsertChanges = Array.isArray(upsert) && upsert.length > 0;
    const hasRemoveChanges = Array.isArray(remove) && remove.length > 0;
    if (hasUpsertChanges === false && hasRemoveChanges === false) {
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
}

export async function listRunnerInventoryTool(
    { projectId }: { projectId: string },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    return withToolTelemetry('list_runner_inventory', async () => {
        const userId = getUserId(extra);
        if (userId === null) return errorResult('Unauthorized');
        const hasProjectAccess = await verifyProjectAccess(projectId, userId);
        if (hasProjectAccess === false) return errorResult('Forbidden');

        try {
            const inventory = await getProjectRunnerInventory(projectId);
            if (inventory === null) {
                return errorResult('Project not found');
            }

            return textResult(inventory);
        } catch {
            return errorResult('Failed to list runner inventory');
        }
    });
}

export async function stopAllRunsTool(
    {
        projectId,
        reason,
    }: { projectId: string; reason?: string },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');
    const hasProjectAccess = await verifyProjectAccess(projectId, userId);
    if (hasProjectAccess === false) return errorResult('Forbidden');

    const activeRuns = await prisma.testRun.findMany({
        where: {
            status: { in: [...RUN_ACTIVE_STATUSES] },
            testCase: { projectId },
        },
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
                error: error instanceof Error ? error.message : 'Unknown error',
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
}

export async function stopAllQueuesTool(
    {
        projectId,
        reason,
    }: { projectId: string; reason?: string },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');
    const hasProjectAccess = await verifyProjectAccess(projectId, userId);
    if (hasProjectAccess === false) return errorResult('Forbidden');

    const queuedRuns = await prisma.testRun.findMany({
        where: {
            status: TEST_STATUS.QUEUED,
            testCase: { projectId },
        },
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
                error: error instanceof Error ? error.message : 'Unknown error',
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
}

export async function deleteTestCaseTool(
    { testCaseId }: { testCaseId: string },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');

    const testCase = await prisma.testCase.findUnique({
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

    if (testCase === null) return errorResult('Not found');
    const hasProjectAccess = await verifyProjectAccess(testCase.projectId, userId);
    if (hasProjectAccess === false) return errorResult('Forbidden');

    const objectKeys = [
        ...testCase.files.map((file) => file.storedName),
        ...testCase.configs.map((config) => config.value),
    ];

    await prisma.testCase.delete({ where: { id: testCaseId } });

    const cleanupResult = await deleteObjectKeysBestEffort(objectKeys);
    return textResult({
        success: true,
        deletedObjectCount: cleanupResult.deletedObjectCount,
        failedObjectKeys: cleanupResult.failedObjectKeys,
    });
}

export async function getTestRunTool(
    { runId }: { runId: string },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');

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

    if (run === null) return errorResult('Not found');
    const hasRunAccess = await isTestRunProjectMember(userId, runId);
    if (hasRunAccess === false) return errorResult('Forbidden');

    return textResult({
        id: run.id,
        status: run.status,
        error: run.error,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
    });
}

export async function getProjectTestSummaryTool(
    { projectId }: { projectId: string },
    extra: McpHandlerExtra
): Promise<ToolResponse> {
    const userId = getUserId(extra);
    if (userId === null) return errorResult('Unauthorized');
    const hasProjectAccess = await verifyProjectAccess(projectId, userId);
    if (hasProjectAccess === false) return errorResult('Forbidden');

    const testCases = await prisma.testCase.findMany({
        where: { projectId },
        select: { status: true },
    });

    const summary: Record<string, number> = {};
    for (const testCase of testCases) {
        summary[testCase.status] = (summary[testCase.status] || 0) + 1;
    }

    return textResult({ total: testCases.length, byStatus: summary });
}

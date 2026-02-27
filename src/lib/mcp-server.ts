import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { batchCreateTestCases } from '@/lib/batch-create';
import { parseTestCaseJson, cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/test-case-utils';
import { compareByGroupThenName } from '@/lib/config-sort';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function getUserId(extra: Extra): string | null {
    return extra.authInfo?.clientId ?? null;
}

function textResult(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true as const };
}

async function verifyProjectOwnership(projectId: string, userId: string): Promise<boolean> {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    return project?.userId === userId;
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
        description: 'Batch create test cases as DRAFT in a project, with optional inline configs',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
            testCases: z.array(z.object({
                name: z.string().describe('Test case name'),
                displayId: z.string().optional().describe('User-facing display ID'),
                url: z.string().optional().describe('Base URL for browser target'),
                prompt: z.string().optional().describe('AI prompt (alternative to steps)'),
                steps: z.array(z.object({
                    id: z.string().describe('Step ID (e.g. "step_1")'),
                    target: z.string().describe('Target ID (e.g. "browser_a")'),
                    action: z.string().describe('Natural language action or verification'),
                    type: z.enum(['ai-action', 'playwright-code']).optional().describe('Step type, default ai-action'),
                })).optional().describe('Test steps'),
                browserConfig: z.record(z.string(), z.unknown()).optional().describe('Browser/Android target configs keyed by target ID'),
                configs: z.array(z.object({
                    name: z.string().describe('Config name (UPPER_SNAKE_CASE)'),
                    type: z.string().describe('URL | VARIABLE | RANDOM_STRING | FILE | APP_ID'),
                    value: z.string().describe('Config value'),
                    masked: z.boolean().optional().describe('Mask value in UI (VARIABLE type only)'),
                    group: z.string().optional().describe('Group name for organization'),
                })).optional().describe('Test case configs'),
            })).describe('Array of test cases to create'),
        },
    }, async ({ projectId, testCases }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        if (!await verifyProjectOwnership(projectId, userId)) return errorResult('Forbidden');
        const result = await batchCreateTestCases(projectId, testCases as import('@/types').BatchTestCaseInput[], 'agent');
        return textResult(result);
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
        },
    }, async ({ testCaseId, ...updates }, extra) => {
        const userId = getUserId(extra);
        if (!userId) return errorResult('Unauthorized');
        const tc = await prisma.testCase.findUnique({
            where: { id: testCaseId },
            include: { project: { select: { userId: true } } }
        });
        if (!tc) return errorResult('Not found');
        if (tc.project.userId !== userId) return errorResult('Forbidden');

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
        return textResult({ id: updated.id, name: updated.name, status: updated.status });
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

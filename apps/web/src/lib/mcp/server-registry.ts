import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpConfigSchema, mcpRunOverridesSchema } from '@/lib/mcp/server-schemas';
import {
    deleteTestCaseTool,
    getProjectTestSummaryTool,
    getProjectTool,
    getTestCaseTool,
    getTestRunTool,
    listProjectsTool,
    listRunnerInventoryTool,
    listTestCasesTool,
    listTestRunsTool,
    manageProjectConfigsTool,
    runTestCaseTool,
    stopAllQueuesTool,
    stopAllRunsTool,
} from '@/lib/mcp/server-tools';
import { registerTestCaseMutationTools } from '@/lib/mcp/test-case-mutation-tools';
import {
    getRunSessionTool,
    listRunSessionsTool,
    runTestGroupTool,
} from '@/lib/mcp/run-session-tools';

export function registerMcpTools(server: McpServer): void {
    server.registerTool('list_projects', {
        description: 'List all projects owned by the authenticated user',
    }, (extra) => listProjectsTool(extra));

    server.registerTool('get_project', {
        description: 'Get project details including project-level configs',
        inputSchema: { projectId: z.string().describe('Project ID') },
    }, ({ projectId }, extra) => getProjectTool({ projectId }, extra));

    server.registerTool('list_test_cases', {
        description: 'List test cases in a project',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
            status: z.string().optional().describe('Filter by status: DRAFT, PASS, FAIL, etc.'),
            limit: z.number().optional().describe('Max results (default 50, max 100)'),
        },
    }, ({ projectId, status, limit }, extra) => listTestCasesTool({ projectId, status, limit }, extra));

    server.registerTool('get_test_case', {
        description: 'Get full test case details: steps, configs, and last 5 runs',
        inputSchema: { testCaseId: z.string().describe('Test case ID') },
    }, ({ testCaseId }, extra) => getTestCaseTool({ testCaseId }, extra));

    server.registerTool('run_test_case', {
        description: 'Queue one test run for a test case with optional per-run overrides.',
        inputSchema: {
            testCaseId: z.string().describe('Test case ID'),
            overrides: mcpRunOverridesSchema.optional().describe('Optional runtime overrides'),
        },
    }, ({ testCaseId, overrides }, extra) => runTestCaseTool({ testCaseId, overrides }, extra));

    server.registerTool('list_test_runs', {
        description: 'List test runs with filters and optional included events/artifacts.',
        inputSchema: {
            projectId: z.string().optional().describe('Optional project ID filter'),
            testCaseId: z.string().optional().describe('Optional test case ID filter'),
            runSessionId: z.string().optional().describe('Optional run session ID filter (all members of one run session)'),
            status: z.string().optional().describe('Optional run status filter'),
            from: z.string().optional().describe('Optional ISO datetime lower bound for createdAt'),
            to: z.string().optional().describe('Optional ISO datetime upper bound for createdAt'),
            limit: z.number().optional().describe('Result size per page (default 20, max 50)'),
            cursor: z.string().optional().describe('Pagination cursor (previous response nextCursor)'),
            include: z.array(z.enum(['events', 'artifacts'])).optional().describe('Optional expansions'),
        },
    }, ({ projectId, testCaseId, runSessionId, status, from, to, limit, cursor, include }, extra) => {
        return listTestRunsTool({ projectId, testCaseId, runSessionId, status, from, to, limit, cursor, include }, extra);
    });

    server.registerTool('manage_project_configs', {
        description: 'Upsert and remove project-level configs in one call. FILE uploads are not supported via MCP.',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
            upsert: z.array(mcpConfigSchema).optional().describe('Configs to create or update by normalized name'),
            remove: z.array(z.string()).optional().describe('Config names to remove'),
        },
    }, ({ projectId, upsert, remove }, extra) => {
        return manageProjectConfigsTool({ projectId, upsert, remove }, extra);
    });

    server.registerTool('list_runner_inventory', {
        description: 'List team runner and Android device inventory scoped by project.',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
        },
    }, ({ projectId }, extra) => listRunnerInventoryTool({ projectId }, extra));

    registerTestCaseMutationTools(server);

    server.registerTool('stop_all_runs', {
        description: 'Cancel all queued/preparing/running test runs for one project owned by the authenticated user.',
        inputSchema: {
            projectId: z.string().describe('Project ID to scope cancellations'),
            reason: z.string().optional().describe('Optional cancellation reason shown in run errors'),
        },
    }, ({ projectId, reason }, extra) => stopAllRunsTool({ projectId, reason }, extra));

    server.registerTool('stop_all_queues', {
        description: 'Cancel all queued test runs (status QUEUED only) for one project owned by the authenticated user.',
        inputSchema: {
            projectId: z.string().describe('Project ID to scope cancellations'),
            reason: z.string().optional().describe('Optional cancellation reason shown in run errors'),
        },
    }, ({ projectId, reason }, extra) => stopAllQueuesTool({ projectId, reason }, extra));

    server.registerTool('delete_test_case', {
        description: 'Delete a test case and all its runs, files, and configs',
        inputSchema: { testCaseId: z.string().describe('Test case ID') },
    }, ({ testCaseId }, extra) => deleteTestCaseTool({ testCaseId }, extra));

    server.registerTool('get_test_run', {
        description: 'Get test run status and result summary',
        inputSchema: { runId: z.string().describe('Test run ID') },
    }, ({ runId }, extra) => getTestRunTool({ runId }, extra));

    server.registerTool('get_project_test_summary', {
        description: 'Get status and kind breakdown of all test cases in a project',
        inputSchema: { projectId: z.string().describe('Project ID') },
    }, ({ projectId }, extra) => getProjectTestSummaryTool({ projectId }, extra));

    server.registerTool('run_test_group', {
        description: 'Queue a test group run session: each login flow runs first to establish a reusable session, then the group\'s test cases run in order. The group\'s configured retry policy applies, so failed cases may be re-run before the session settles.',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
            testGroupId: z.string().describe('Test group ID'),
        },
    }, ({ projectId, testGroupId }, extra) => runTestGroupTool({ projectId, testGroupId }, extra));

    server.registerTool('get_run_session', {
        description: 'Get a run session\'s rolled-up status and each member run\'s status. Use this (not get_test_run on a single member) to tell whether a whole group/login-flow run settled. A retried group repeats a case once per attempt: take the highest `attempt` per testCaseId as that case\'s outcome.',
        inputSchema: { runSessionId: z.string().describe('Run session ID') },
    }, ({ runSessionId }, extra) => getRunSessionTool({ runSessionId }, extra));

    server.registerTool('list_run_sessions', {
        description: 'List a project\'s run sessions (most recent first), optionally scoped to one test group.',
        inputSchema: {
            projectId: z.string().describe('Project ID'),
            testGroupId: z.string().optional().describe('Optional test group ID filter'),
            limit: z.number().optional().describe('Max results (default 20, max 50)'),
        },
    }, ({ projectId, testGroupId, limit }, extra) => listRunSessionsTool({ projectId, testGroupId, limit }, extra));
}

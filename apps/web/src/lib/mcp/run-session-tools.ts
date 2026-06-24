import { prisma } from '@/lib/core/prisma';
import { queueTestGroupRun } from '@/lib/test-groups/test-group-service';
import { cancellationReasonCodeFor } from '@/lib/runtime/cancellation-reasons';
import { getUserId, type McpHandlerExtra, verifyProjectAccess } from '@/lib/mcp/server-auth';
import { errorResult, textResult, withToolTelemetry, type ToolResponse } from '@/lib/mcp/server-response';
import { RUN_TRIGGER_SOURCE } from '@/types';

/** Launches a test group run session (login-flow prefixes + ordered cases) for an MCP agent. */
export async function runTestGroupTool(
    { projectId, testGroupId }: { projectId: string; testGroupId: string },
    extra: McpHandlerExtra,
): Promise<ToolResponse> {
    return withToolTelemetry('run_test_group', async () => {
        const userId = getUserId(extra);
        if (userId === null) return errorResult('Unauthorized');
        if (!await verifyProjectAccess(projectId, userId)) return errorResult('Forbidden');

        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        const result = await queueTestGroupRun(projectId, testGroupId, {
            triggeredByEmail: user?.email ?? null,
            triggerSource: RUN_TRIGGER_SOURCE.USER,
        });
        if (!result.ok) {
            return errorResult(result.error, { status: result.status });
        }
        return textResult(result.data);
    });
}

/** Returns a run session's rolled-up status plus each member's status, so an agent can tell whether the whole session settled (not just one member). */
export async function getRunSessionTool(
    { runSessionId }: { runSessionId: string },
    extra: McpHandlerExtra,
): Promise<ToolResponse> {
    return withToolTelemetry('get_run_session', async () => {
        const userId = getUserId(extra);
        if (userId === null) return errorResult('Unauthorized');

        const session = await prisma.runSession.findUnique({
            where: { id: runSessionId },
            select: {
                id: true,
                projectId: true,
                kind: true,
                status: true,
                testGroupId: true,
                startedAt: true,
                completedAt: true,
                createdAt: true,
                memberRuns: {
                    orderBy: { sessionPosition: 'asc' },
                    select: {
                        id: true,
                        testCaseId: true,
                        kind: true,
                        sessionPosition: true,
                        status: true,
                        error: true,
                    },
                },
            },
        });
        if (session === null) return errorResult('Not found');
        if (!await verifyProjectAccess(session.projectId, userId)) return errorResult('Forbidden');

        return textResult({
            id: session.id,
            kind: session.kind,
            status: session.status,
            testGroupId: session.testGroupId,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
            createdAt: session.createdAt,
            members: session.memberRuns.map((member) => ({
                id: member.id,
                testCaseId: member.testCaseId,
                kind: member.kind,
                sessionPosition: member.sessionPosition,
                status: member.status,
                error: member.error,
                cancellationReasonCode: cancellationReasonCodeFor(member.status, member.error),
            })),
        });
    });
}

/** Lists a project's run sessions (most recent first), optionally scoped to one test group. */
export async function listRunSessionsTool(
    { projectId, testGroupId, limit }: { projectId: string; testGroupId?: string; limit?: number },
    extra: McpHandlerExtra,
): Promise<ToolResponse> {
    return withToolTelemetry('list_run_sessions', async () => {
        const userId = getUserId(extra);
        if (userId === null) return errorResult('Unauthorized');
        if (!await verifyProjectAccess(projectId, userId)) return errorResult('Forbidden');

        const take = Math.max(1, Math.min(limit ?? 20, 50));
        const sessions = await prisma.runSession.findMany({
            where: { projectId, deletedAt: null, ...(testGroupId ? { testGroupId } : {}) },
            orderBy: { createdAt: 'desc' },
            take,
            select: {
                id: true,
                kind: true,
                status: true,
                testGroupId: true,
                startedAt: true,
                completedAt: true,
                createdAt: true,
                _count: { select: { memberRuns: true } },
            },
        });

        return textResult(sessions.map((session) => ({
            id: session.id,
            kind: session.kind,
            status: session.status,
            testGroupId: session.testGroupId,
            memberCount: session._count.memberRuns,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
            createdAt: session.createdAt,
        })));
    });
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { cancelActiveRunSession } from '@/lib/runtime/cancel-run';

const logger = createLogger('api:projects:run-session');

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const session = await prisma.runSession.findFirst({
            where: { id: guard.params.sessionId, projectId: guard.params.id },
            select: {
                id: true,
                kind: true,
                status: true,
                testGroupId: true,
                startedAt: true,
                completedAt: true,
                createdAt: true,
                project: { select: { name: true } },
                testGroup: { select: { name: true } },
                memberRuns: {
                    orderBy: { sessionPosition: 'asc' },
                    select: {
                        id: true,
                        testCaseId: true,
                        kind: true,
                        sessionPosition: true,
                        status: true,
                        reusedSession: true,
                        startedAt: true,
                        createdAt: true,
                        testCase: { select: { displayId: true, name: true } },
                    },
                },
            },
        });
        if (!session) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Run session not found' });
        }
        return NextResponse.json({
            id: session.id,
            kind: session.kind,
            status: session.status,
            testGroupId: session.testGroupId,
            projectName: session.project.name,
            groupName: session.testGroup?.name ?? null,
            startedAt: session.startedAt?.toISOString() ?? null,
            completedAt: session.completedAt?.toISOString() ?? null,
            createdAt: session.createdAt.toISOString(),
            members: session.memberRuns.map((member) => ({
                runId: member.id,
                testCaseId: member.testCaseId,
                kind: member.kind,
                sessionPosition: member.sessionPosition,
                status: member.status,
                reusedSession: member.reusedSession,
                startedAt: (member.startedAt ?? member.createdAt).toISOString(),
                displayId: member.testCase.displayId,
                name: member.testCase.name,
            })),
        });
    } catch (error) {
        logger.error('Failed to load run session', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to load run session' });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const { id: projectId, sessionId } = guard.params;
        const { userId } = guard;

        const session = await prisma.runSession.findFirst({
            where: { id: sessionId, projectId },
            select: { id: true },
        });
        if (!session) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Run session not found' });
        }

        const { cancelledMembers } = await cancelActiveRunSession(sessionId);

        const updated = await prisma.runSession.findUnique({
            where: { id: sessionId },
            select: { status: true },
        });

        logger.info('Cancelled run session', {
            sessionId,
            projectId,
            cancelledMembers,
            cancelledByUserId: userId,
        });

        return NextResponse.json({ success: true, id: sessionId, status: updated?.status ?? null, cancelledMembers });
    } catch (error) {
        logger.error('Failed to cancel run session', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to cancel run session' });
    }
}

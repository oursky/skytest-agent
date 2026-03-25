import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isProjectMember } from '@/lib/security/permissions';
import { createRoutePerfTracker, measureJsonBytes } from '@/lib/core/route-perf';

const logger = createLogger('api:test-cases:history');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const perf = createRoutePerfTracker('/api/test-cases/[id]/history', request);
    const authPayload = await perf.measureAuth(() => verifyAuth(request));
    if (!authPayload) {
        const body = { error: 'Unauthorized' };
        perf.log(logger, { statusCode: 401, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 401 });
    }

    try {
        const { id } = await params;
        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
        const skip = (page - 1) * limit;
        const includePayload = url.searchParams.get('includePayload') === '1';

        const testCase = await perf.measureDb(() => prisma.testCase.findUnique({
            where: { id },
            select: { id: true, projectId: true }
        }));

        if (!testCase) {
            const body = { error: 'Test case not found' };
            perf.log(logger, { statusCode: 404, responseBytes: measureJsonBytes(body) });
            return NextResponse.json(body, { status: 404 });
        }

        const userId = await perf.measureAuth(() => resolveUserId(authPayload));
        if (!userId) {
            const body = { error: 'Unauthorized' };
            perf.log(logger, { statusCode: 401, responseBytes: measureJsonBytes(body) });
            return NextResponse.json(body, { status: 401 });
        }
        if (!await perf.measureDb(() => isProjectMember(userId, testCase.projectId))) {
            const body = { error: 'Forbidden' };
            perf.log(logger, { statusCode: 403, responseBytes: measureJsonBytes(body) });
            return NextResponse.json(body, { status: 403 });
        }

        const testRunsPromise = includePayload
            ? prisma.testRun.findMany({
                where: {
                    testCaseId: id,
                    deletedAt: null,
                },
                orderBy: { createdAt: 'desc' },
                include: { files: true },
                skip,
                take: limit
            })
            : prisma.testRun.findMany({
                where: {
                    testCaseId: id,
                    deletedAt: null,
                },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    status: true,
                    createdAt: true,
                    error: true,
                },
                skip,
                take: limit
            });

        const [testRuns, total] = await perf.measureDb(() => Promise.all([
            testRunsPromise,
            prisma.testRun.count({
                where: {
                    testCaseId: id,
                    deletedAt: null,
                },
            })
        ]));

        const body = {
            data: testRuns,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        };
        perf.log(logger, { statusCode: 200, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body);
    } catch (error) {
        logger.error('Failed to fetch test history', error);
        const body = { error: 'Failed to fetch test history' };
        perf.log(logger, { statusCode: 500, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 500 });
    }
}

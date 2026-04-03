import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { isProjectMember } from '@/lib/security/permissions';
import { resolveUserId, verifyAuth } from '@/lib/security/auth';
import { apiError, type ApiErrorResponse } from '@/lib/security/api-route-standards';

export type TestRunRouteGuardResult<TParams extends { id: string }> =
    | {
        ok: true;
        params: TParams;
        userId: string;
        testRunId: string;
        testCaseId: string;
        projectId: string;
    }
    | {
        ok: false;
        response: NextResponse<ApiErrorResponse>;
    };

export async function guardTestRunRouteRequest<TParams extends { id: string }>(input: {
    request: Request;
    params: Promise<TParams>;
}): Promise<TestRunRouteGuardResult<TParams>> {
    const authPayload = await verifyAuth(input.request);
    if (!authPayload) {
        return {
            ok: false,
            response: apiError({
                status: 401,
                code: 'UNAUTHORIZED',
                error: 'Unauthorized',
            }),
        };
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return {
            ok: false,
            response: apiError({
                status: 401,
                code: 'UNAUTHORIZED',
                error: 'Unauthorized',
            }),
        };
    }

    const params = await input.params;
    const testRun = await prisma.testRun.findUnique({
        where: { id: params.id },
        select: {
            id: true,
            testCaseId: true,
            testCase: {
                select: {
                    projectId: true,
                },
            },
        },
    });

    if (!testRun) {
        return {
            ok: false,
            response: apiError({
                status: 404,
                code: 'NOT_FOUND',
                error: 'Test run not found',
            }),
        };
    }

    if (!await isProjectMember(userId, testRun.testCase.projectId)) {
        return {
            ok: false,
            response: apiError({
                status: 403,
                code: 'FORBIDDEN',
                error: 'Forbidden',
            }),
        };
    }

    return {
        ok: true,
        params,
        userId,
        testRunId: testRun.id,
        testCaseId: testRun.testCaseId,
        projectId: testRun.testCase.projectId,
    };
}

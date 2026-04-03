import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { isProjectMember } from '@/lib/security/permissions';
import { resolveUserId, verifyAuth } from '@/lib/security/auth';
import { apiError, type ApiErrorResponse } from '@/lib/security/api-route-standards';

type DefaultTestCaseRoutePayload = Prisma.TestCaseGetPayload<{
    select: {
        id: true;
        projectId: true;
    };
}>;
type TestCaseRouteQuery = Pick<Prisma.TestCaseDefaultArgs, 'select' | 'include'>;
type GuardedTestCasePayload<TQuery extends TestCaseRouteQuery | undefined> =
    TQuery extends TestCaseRouteQuery
        ? Prisma.TestCaseGetPayload<TQuery> & { id: string; projectId: string }
        : DefaultTestCaseRoutePayload;

export type TestCaseRouteGuardResult<
    TParams extends { id: string },
    TTestCase extends { id: string; projectId: string },
> =
    | {
        ok: true;
        params: TParams;
        userId: string;
        testCaseId: string;
        projectId: string;
        testCase: TTestCase;
    }
    | {
        ok: false;
        response: NextResponse<ApiErrorResponse>;
    };

export async function guardTestCaseRouteRequest<
    TParams extends { id: string },
    TQuery extends TestCaseRouteQuery | undefined = undefined,
>(input: {
    request: Request;
    params: Promise<TParams>;
    query?: TQuery;
}): Promise<TestCaseRouteGuardResult<TParams, GuardedTestCasePayload<TQuery>>> {
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
    const testCaseQueryArgs: Prisma.TestCaseFindUniqueArgs = input.query?.include
        ? {
            where: { id: params.id },
            include: input.query.include,
        }
        : {
            where: { id: params.id },
            select: {
                ...(input.query?.select ?? {}),
                id: true,
                projectId: true,
            },
        };
    const testCase = await prisma.testCase.findUnique(testCaseQueryArgs);

    if (!testCase) {
        return {
            ok: false,
            response: apiError({
                status: 404,
                code: 'NOT_FOUND',
                error: 'Test case not found',
            }),
        };
    }

    const projectId = testCase.projectId;
    if (!await isProjectMember(userId, projectId)) {
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
        testCaseId: testCase.id,
        projectId,
        testCase: testCase as GuardedTestCasePayload<TQuery>,
    };
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { isProjectMember } from '@/lib/security/permissions';
import { resolveUserId, verifyAuth } from '@/lib/security/auth';

export type TestCaseRouteGuardResult<TParams extends { id: string }> =
    | {
        ok: true;
        params: TParams;
        userId: string;
        testCaseId: string;
        projectId: string;
    }
    | {
        ok: false;
        response: NextResponse<{ error: string }>;
    };

export async function guardTestCaseRouteRequest<TParams extends { id: string }>(input: {
    request: Request;
    params: Promise<TParams>;
}): Promise<TestCaseRouteGuardResult<TParams>> {
    const authPayload = await verifyAuth(input.request);
    if (!authPayload) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        };
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        };
    }

    const params = await input.params;
    const testCase = await prisma.testCase.findUnique({
        where: { id: params.id },
        select: {
            id: true,
            projectId: true,
        },
    });

    if (!testCase) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Test case not found' }, { status: 404 }),
        };
    }

    if (!await isProjectMember(userId, testCase.projectId)) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        };
    }

    return {
        ok: true,
        params,
        userId,
        testCaseId: testCase.id,
        projectId: testCase.projectId,
    };
}

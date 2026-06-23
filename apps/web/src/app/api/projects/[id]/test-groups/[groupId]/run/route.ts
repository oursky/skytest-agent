import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { queueTestGroupRun } from '@/lib/test-groups/test-group-service';
import { RUN_TRIGGER_SOURCE } from '@/types';

const logger = createLogger('api:projects:test-group:run');

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const user = await prisma.user.findUnique({ where: { id: guard.userId }, select: { email: true } });
        const result = await queueTestGroupRun(guard.params.id, guard.params.groupId, {
            triggeredByEmail: user?.email ?? null,
            triggerSource: RUN_TRIGGER_SOURCE.USER,
        });
        if (!result.ok) {
            return apiError({
                status: result.status,
                code: result.status === 404 ? 'NOT_FOUND' : result.status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR',
                error: result.error,
            });
        }
        return NextResponse.json(result.data);
    } catch (error) {
        logger.error('Failed to start test group', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to start test group' });
    }
}

import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { cancelActiveTestRun } from '@/lib/runtime/cancel-run';
import { guardTestRunRouteRequest } from '@/lib/security/test-run-route-access';
import { apiError } from '@/lib/security/api-route-standards';

const logger = createLogger('api:test-runs:cancel');

export const dynamic = 'force-dynamic';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTestRunRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;
        const { userId } = guard;

        const result = await cancelActiveTestRun(id);

        if (!result) {
            return apiError({
                status: 404,
                code: 'NOT_FOUND',
                error: 'Test run not found',
            });
        }

        logger.info('Cancelled test run', {
            runId: id,
            previousStatus: result.previousStatus,
            previousAssignedRunnerId: result.previousAssignedRunnerId,
            finalStatus: result.finalStatus,
            cancelledByUserId: userId,
        });

        return NextResponse.json({ success: true, id: result.id, status: result.finalStatus });
    } catch (error) {
        logger.error('Failed to cancel test run', error);
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to cancel test run',
        });
    }
}

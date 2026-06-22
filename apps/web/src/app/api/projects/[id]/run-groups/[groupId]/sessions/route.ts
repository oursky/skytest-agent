import { NextResponse } from 'next/server';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { listRunGroupSessions } from '@/lib/run-groups/run-group-service';

const logger = createLogger('api:projects:run-group-sessions');

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));

        const result = await listRunGroupSessions(guard.params.id, guard.params.groupId, page, limit);
        if (!result.ok) {
            return apiError({ status: result.status, code: 'NOT_FOUND', error: result.error });
        }

        return NextResponse.json({
            groupName: result.data.groupName,
            projectName: result.data.projectName,
            data: result.data.sessions,
            pagination: {
                page,
                limit,
                total: result.data.total,
                totalPages: Math.max(1, Math.ceil(result.data.total / limit)),
            },
        });
    } catch (error) {
        logger.error('Failed to list run group sessions', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to list run group sessions' });
    }
}

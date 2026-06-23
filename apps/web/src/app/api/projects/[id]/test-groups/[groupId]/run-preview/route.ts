import { NextResponse } from 'next/server';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { getTestGroupRunPreview } from '@/lib/test-groups/test-group-service';

const logger = createLogger('api:projects:test-group:run-preview');

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const preview = await getTestGroupRunPreview(guard.params.id, guard.params.groupId);
        if (!preview) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Test group not found' });
        }
        return NextResponse.json(preview);
    } catch (error) {
        logger.error('Failed to load test group run preview', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to load test group run preview' });
    }
}

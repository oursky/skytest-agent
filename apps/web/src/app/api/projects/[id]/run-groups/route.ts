import { NextResponse } from 'next/server';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { createRunGroup, listRunGroups } from '@/lib/run-groups/run-group-service';
import type { RunGroupUpsertInput } from '@/types';

const logger = createLogger('api:projects:run-groups');

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const groups = await listRunGroups(guard.params.id);
        return NextResponse.json(groups);
    } catch (error) {
        logger.error('Failed to list run groups', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to list run groups' });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const body = (await request.json()) as RunGroupUpsertInput;
        const result = await createRunGroup(guard.params.id, body);
        if (!result.ok) {
            return apiError({ status: result.status, code: 'VALIDATION_ERROR', error: result.error });
        }
        return NextResponse.json(result.data, { status: 201 });
    } catch (error) {
        logger.error('Failed to create run group', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to create run group' });
    }
}

import { NextResponse } from 'next/server';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { deleteRunGroup, getRunGroup, updateRunGroup } from '@/lib/run-groups/run-group-service';
import type { RunGroupUpsertInput } from '@/types';

const logger = createLogger('api:projects:run-group');

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const group = await getRunGroup(guard.params.id, guard.params.groupId);
        if (!group) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Run group not found' });
        }
        return NextResponse.json(group);
    } catch (error) {
        logger.error('Failed to load run group', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to load run group' });
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const body = (await request.json()) as RunGroupUpsertInput;
        const result = await updateRunGroup(guard.params.id, guard.params.groupId, body);
        if (!result.ok) {
            return apiError({ status: result.status, code: result.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', error: result.error });
        }
        return NextResponse.json(result.data);
    } catch (error) {
        logger.error('Failed to update run group', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to update run group' });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const result = await deleteRunGroup(guard.params.id, guard.params.groupId);
        if (!result.ok) {
            return apiError({ status: result.status, code: 'NOT_FOUND', error: result.error });
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        logger.error('Failed to delete run group', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to delete run group' });
    }
}

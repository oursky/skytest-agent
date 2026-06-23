import { NextResponse } from 'next/server';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { deleteTestGroup, getTestGroup, updateTestGroup } from '@/lib/test-groups/test-group-service';
import type { TestGroupUpsertInput } from '@/types';

const logger = createLogger('api:projects:test-group');

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const group = await getTestGroup(guard.params.id, guard.params.groupId);
        if (!group) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Test group not found' });
        }
        return NextResponse.json(group);
    } catch (error) {
        logger.error('Failed to load test group', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to load test group' });
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const body = (await request.json()) as TestGroupUpsertInput;
        const result = await updateTestGroup(guard.params.id, guard.params.groupId, body);
        if (!result.ok) {
            const code = result.status === 404 ? 'NOT_FOUND' : result.status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR';
            return apiError({ status: result.status, code, error: result.error });
        }
        return NextResponse.json(result.data);
    } catch (error) {
        logger.error('Failed to update test group', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to update test group' });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }
    try {
        const result = await deleteTestGroup(guard.params.id, guard.params.groupId);
        if (!result.ok) {
            return apiError({ status: result.status, code: result.status === 409 ? 'CONFLICT' : 'NOT_FOUND', error: result.error });
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        logger.error('Failed to delete test group', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to delete test group' });
    }
}

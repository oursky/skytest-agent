import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { deleteProjectSchedule, getProjectSchedule, isSchedulerValidationError, updateProjectSchedule } from '@/lib/scheduler/schedule-service';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { type ScheduleUpsertInput } from '@/types';

const logger = createLogger('api:projects:schedules:id');

export const dynamic = 'force-dynamic';

type RouteParams = { id: string; scheduleId: string };

export async function GET(
    request: Request,
    { params }: { params: Promise<RouteParams> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const schedule = await getProjectSchedule(guard.params.id, guard.params.scheduleId);
        if (!schedule) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Schedule not found' });
        }
        return NextResponse.json(schedule);
    } catch (error) {
        logger.error('Failed to fetch project schedule', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to fetch schedule' });
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<RouteParams> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const body = await request.json() as ScheduleUpsertInput;
        const schedule = await updateProjectSchedule({
            projectId: guard.params.id,
            scheduleId: guard.params.scheduleId,
            body,
        });
        if (!schedule) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Schedule not found' });
        }
        return NextResponse.json(schedule);
    } catch (error) {
        if (isSchedulerValidationError(error)) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: error.message });
        }
        logger.error('Failed to update project schedule', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to update schedule' });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<RouteParams> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const deleted = await deleteProjectSchedule(guard.params.id, guard.params.scheduleId);
        if (!deleted) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Schedule not found' });
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        logger.error('Failed to delete project schedule', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to delete schedule' });
    }
}

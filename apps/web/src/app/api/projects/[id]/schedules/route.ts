import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { createProjectSchedule, isSchedulerValidationError, listProjectSchedules } from '@/lib/scheduler/schedule-service';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { type ScheduleUpsertInput } from '@/types';

const logger = createLogger('api:projects:schedules');

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const schedules = await listProjectSchedules(guard.params.id);
        return NextResponse.json(schedules);
    } catch (error) {
        logger.error('Failed to list project schedules', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to list schedules' });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const body = await request.json() as ScheduleUpsertInput;
        const schedule = await createProjectSchedule({
            projectId: guard.params.id,
            userId: guard.userId,
            body,
        });
        return NextResponse.json(schedule, { status: 201 });
    } catch (error) {
        if (isSchedulerValidationError(error)) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: error.message });
        }
        logger.error('Failed to create project schedule', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to create schedule' });
    }
}

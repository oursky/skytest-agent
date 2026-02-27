import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { batchCreateTestCases } from '@/lib/batch-create';
import { createLogger } from '@/lib/logger';
import { config as appConfig } from '@/config/app';
import type { BatchCreateRequest } from '@/types';

const logger = createLogger('api:projects:test-cases:batch');

export const dynamic = 'force-dynamic';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const project = await prisma.project.findUnique({ where: { id }, select: { userId: true } });
        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }
        if (project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as BatchCreateRequest;
        if (!Array.isArray(body.testCases) || body.testCases.length === 0) {
            return NextResponse.json({ error: 'testCases array is required and must not be empty' }, { status: 400 });
        }

        const maxBatch = appConfig.api.batch.maxTestCasesPerBatch;
        if (body.testCases.length > maxBatch) {
            return NextResponse.json({ error: `Maximum ${maxBatch} test cases per batch` }, { status: 400 });
        }

        const result = await batchCreateTestCases(id, body.testCases, body.source || 'api');
        return NextResponse.json(result);
    } catch (error) {
        logger.error('Failed to batch create test cases', error);
        return NextResponse.json({ error: 'Failed to batch create test cases' }, { status: 500 });
    }
}

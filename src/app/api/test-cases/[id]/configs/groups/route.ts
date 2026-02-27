import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { GROUPABLE_CONFIG_TYPES, normalizeConfigGroup } from '@/lib/config-sort';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:test-cases:config-groups');

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({} as { group?: string | null }));
        const normalizedGroup = normalizeConfigGroup(body.group);

        if (!normalizedGroup) {
            return NextResponse.json({ error: 'Group is required' }, { status: 400 });
        }

        const testCase = await prisma.testCase.findUnique({
            where: { id },
            include: { project: { select: { userId: true } } }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const result = await prisma.testCaseConfig.updateMany({
            where: {
                testCaseId: id,
                type: { in: GROUPABLE_CONFIG_TYPES },
                group: normalizedGroup,
            },
            data: {
                group: null,
            }
        });

        return NextResponse.json({ success: true, updated: result.count });
    } catch (error) {
        logger.error('Failed to remove test case config group', error);
        return NextResponse.json({ error: 'Failed to remove group' }, { status: 500 });
    }
}

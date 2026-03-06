import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isProjectMember } from '@/lib/security/permissions';

const logger = createLogger('api:projects:usage');

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const hasAccess = await isProjectMember(userId, id);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10)));

        const where = { projectId: id };

        const [records, total] = await Promise.all([
            prisma.usageRecord.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    actorUser: {
                        select: {
                            id: true,
                            email: true,
                        }
                    },
                    testRun: {
                        select: {
                            id: true,
                            testCase: {
                                select: {
                                    id: true,
                                    name: true,
                                    projectId: true,
                                }
                            }
                        }
                    }
                }
            }),
            prisma.usageRecord.count({ where }),
        ]);

        return NextResponse.json({
            records,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            }
        });
    } catch (error) {
        logger.error('Failed to fetch project usage records', error);
        return NextResponse.json({ error: 'Failed to fetch project usage records' }, { status: 500 });
    }
}

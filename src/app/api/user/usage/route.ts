import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:user:usage');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    try {
        const resolvedUserId = await resolveUserId(authPayload);
        if (!resolvedUserId) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const where = { userId: resolvedUserId };

        const [records, total] = await Promise.all([
            prisma.usageRecord.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    testRun: {
                        select: {
                            id: true,
                            testCase: {
                                select: {
                                    id: true,
                                    name: true,
                                    projectId: true
                                }
                            }
                        }
                    }
                }
            }),
            prisma.usageRecord.count({ where })
        ]);

        return NextResponse.json({
            records,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        logger.error('Failed to fetch usage records', error);
        return NextResponse.json({ error: 'Failed to fetch usage records' }, { status: 500 });
    }
}

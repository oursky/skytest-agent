import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload || !authPayload.sub) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = authPayload.sub;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    try {
        const user = await prisma.user.findUnique({
            where: { authId: userId },
            select: { id: true }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const where = { userId: user.id };

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
        console.error('Failed to fetch usage records:', error);
        return NextResponse.json({ error: 'Failed to fetch usage records' }, { status: 500 });
    }
}

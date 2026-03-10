import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isTeamMember } from '@/lib/security/permissions';
import { parseActionCountFromResult } from '@/lib/runtime/usage';

const logger = createLogger('api:teams:usage');

export const dynamic = 'force-dynamic';

async function backfillTeamUsageRecords(teamId: string, projectId?: string) {
    const runsWithoutUsage = await prisma.testRun.findMany({
        where: {
            status: { in: ['PASS', 'FAIL', 'CANCELLED'] },
            result: { not: null },
            usageRecords: { none: {} },
            testCase: {
                project: {
                    teamId,
                    ...(projectId ? { id: projectId } : {})
                }
            }
        },
        orderBy: { completedAt: 'desc' },
        take: 200,
        select: {
            id: true,
            result: true,
            testCase: {
                select: {
                    name: true,
                    project: {
                        select: {
                            id: true,
                            name: true,
                            createdByUserId: true,
                        }
                    }
                }
            }
        }
    });

    for (const run of runsWithoutUsage) {
        const actionCount = parseActionCountFromResult(run.result ?? undefined);
        if (actionCount <= 0) {
            continue;
        }

        const existing = await prisma.usageRecord.findFirst({
            where: { testRunId: run.id },
            select: { id: true },
        });
        if (existing) {
            continue;
        }

        await prisma.usageRecord.create({
            data: {
                actorUserId: run.testCase.project.createdByUserId,
                projectId: run.testCase.project.id,
                type: 'TEST_RUN',
                description: `${run.testCase.project.name} - ${run.testCase.name}`,
                aiActions: actionCount,
                testRunId: run.id,
            }
        });
    }
}

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
        if (!await isTeamMember(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10)));
        const projectId = searchParams.get('projectId')?.trim() || undefined;
        const from = searchParams.get('from')?.trim() || undefined;
        const to = searchParams.get('to')?.trim() || undefined;

        await backfillTeamUsageRecords(id, projectId);

        const where = {
            project: {
                teamId: id,
                ...(projectId ? { id: projectId } : {}),
            },
            ...(from || to ? {
                createdAt: {
                    ...(from ? { gte: new Date(from) } : {}),
                    ...(to ? { lte: new Date(to) } : {}),
                }
            } : {}),
        };

        const [records, total] = await Promise.all([
            prisma.usageRecord.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    project: {
                        select: {
                            id: true,
                            name: true,
                        }
                    },
                    testRun: {
                        select: {
                            id: true,
                            createdAt: true,
                            testCase: {
                                select: {
                                    id: true,
                                    displayId: true,
                                    name: true,
                                }
                            }
                        }
                    },
                    actorUser: {
                        select: {
                            id: true,
                            email: true,
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
        logger.error('Failed to fetch team usage', error);
        return NextResponse.json({ error: 'Failed to load team usage' }, { status: 500 });
    }
}

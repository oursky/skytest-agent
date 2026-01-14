import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
        const skip = (page - 1) * limit;

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

        const [testRuns, total] = await Promise.all([
            prisma.testRun.findMany({
                where: { testCaseId: id },
                orderBy: { createdAt: 'desc' },
                include: { files: true },
                skip,
                take: limit
            }),
            prisma.testRun.count({ where: { testCaseId: id } })
        ]);

        return NextResponse.json({
            data: testRuns,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Failed to fetch test history:', error);
        return NextResponse.json({ error: 'Failed to fetch test history' }, { status: 500 });
    }
}

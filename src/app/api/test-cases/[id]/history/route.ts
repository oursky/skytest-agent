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
        const testRuns = await prisma.testRun.findMany({
            where: { testCaseId: id },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json(testRuns);
    } catch (error) {
        console.error('Failed to fetch test history:', error);
        return NextResponse.json({ error: 'Failed to fetch test history' }, { status: 500 });
    }
}

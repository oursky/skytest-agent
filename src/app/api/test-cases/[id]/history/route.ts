import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
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

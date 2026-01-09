
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queue } from '@/lib/queue';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        queue.cancel(id);

        const testRun = await prisma.testRun.findUnique({
            where: { id }
        });

        return NextResponse.json(testRun);
    } catch (error) {
        console.error('Failed to cancel test run:', error);
        return NextResponse.json({ error: 'Failed to cancel test run' }, { status: 500 });
    }
}

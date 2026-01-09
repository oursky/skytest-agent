import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queue } from '@/lib/queue';
import { TestRun } from '@/types';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const testRun = await prisma.testRun.findUnique({
            where: { id },
        });

        if (!testRun) {
            return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
        }

        return NextResponse.json(testRun);
    } catch (error) {
        console.error('Failed to fetch test run:', error);
        return NextResponse.json({ error: 'Failed to fetch test run' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        try {
            queue.cancel(id);
        } catch (e) {
            console.error('Failed to cancel job from queue:', e);
        }

        await prisma.testRun.delete({
            where: { id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete test run:', error);
        return NextResponse.json({ error: 'Failed to delete test run' }, { status: 500 });
    }
}

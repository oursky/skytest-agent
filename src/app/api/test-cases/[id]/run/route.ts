import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { status, result, error } = body;

        if (!status) {
            return NextResponse.json({ error: 'Status is required' }, { status: 400 });
        }

        const testRun = await prisma.testRun.create({
            data: {
                testCaseId: id,
                status,
                result: result ? JSON.stringify(result) : null,
                error,
            },
        });

        return NextResponse.json(testRun);
    } catch (error) {
        console.error('Failed to record test run:', error);
        return NextResponse.json({ error: 'Failed to record test run' }, { status: 500 });
    }
}

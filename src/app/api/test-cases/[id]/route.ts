import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { name, url, prompt, username, password } = body;

        const testCase = await prisma.testCase.update({
            where: { id },
            data: {
                name,
                url,
                prompt,
                username,
                password,
            },
        });

        return NextResponse.json(testCase);
    } catch (error) {
        console.error('Failed to update test case:', error);
        return NextResponse.json({ error: 'Failed to update test case' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        await prisma.testCase.delete({
            where: { id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete test case:', error);
        return NextResponse.json({ error: 'Failed to delete test case' }, { status: 500 });
    }
}

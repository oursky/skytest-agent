import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const testCases = await prisma.testCase.findMany({
            where: { projectId: id },
            orderBy: { updatedAt: 'desc' },
            include: {
                testRuns: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        return NextResponse.json(testCases);
    } catch (error) {
        console.error('Failed to fetch test cases:', error);
        return NextResponse.json({ error: 'Failed to fetch test cases' }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { name, url, prompt, username, password } = body;

        if (!name || !url || !prompt) {
            return NextResponse.json({ error: 'Name, URL, and Prompt are required' }, { status: 400 });
        }

        const testCase = await prisma.testCase.create({
            data: {
                name,
                url,
                prompt,
                username,
                password,
                projectId: id,
            },
        });

        return NextResponse.json(testCase);
    } catch (error) {
        console.error('Failed to create test case:', error);
        return NextResponse.json({ error: 'Failed to create test case' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

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
        const { name, url, prompt, steps, browserConfig, username, password } = body;

        const hasSteps = steps && Array.isArray(steps) && steps.length > 0;
        const hasBrowserConfig = browserConfig && Object.keys(browserConfig).length > 0;

        if (!name || !url || (!prompt && !hasSteps)) {
            return NextResponse.json({ error: 'Name, URL, and either Prompt or Steps are required' }, { status: 400 });
        }

        const testCase = await prisma.testCase.create({
            data: {
                name,
                url,
                prompt,
                steps: hasSteps ? JSON.stringify(steps) : undefined,
                browserConfig: hasBrowserConfig ? JSON.stringify(browserConfig) : undefined,
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

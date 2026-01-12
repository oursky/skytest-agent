import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { TestStep } from '@/types';

function cleanStepsForStorage(steps: TestStep[]): TestStep[] {
    return steps.map(({ aiAction, codeAction, ...step }) => step);
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
        const { id } = await params;
        const testCase = await prisma.testCase.findUnique({
            where: { id },
            include: {
                testRuns: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    select: { id: true, status: true, createdAt: true }
                }
            }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        const parsedTestCase = {
            ...testCase,
            steps: testCase.steps ? JSON.parse(testCase.steps) : undefined,
            browserConfig: testCase.browserConfig ? JSON.parse(testCase.browserConfig) : undefined,
        };

        return NextResponse.json(parsedTestCase);
    } catch (error) {
        console.error('Failed to fetch test case:', error);
        return NextResponse.json({ error: 'Failed to fetch test case' }, { status: 500 });
    }
}


export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const body = await request.json();
        const { name, url, prompt, steps, browserConfig, username, password } = body;

        const hasSteps = steps && Array.isArray(steps) && steps.length > 0;
        const hasBrowserConfig = browserConfig && Object.keys(browserConfig).length > 0;
        const cleanedSteps = hasSteps ? cleanStepsForStorage(steps) : undefined;

        const testCase = await prisma.testCase.update({
            where: { id },
            data: {
                name,
                url,
                prompt,
                steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
                browserConfig: hasBrowserConfig ? JSON.stringify(browserConfig) : undefined,
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
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

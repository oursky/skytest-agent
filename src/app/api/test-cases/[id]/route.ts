import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { TestStep } from '@/types';
import { getUploadPath } from '@/lib/file-security';
import fs from 'fs/promises';

type AuthPayload = NonNullable<Awaited<ReturnType<typeof verifyAuth>>>;

async function resolveUserId(authPayload: AuthPayload): Promise<string | null> {
    if (authPayload.userId) return authPayload.userId;
    const authId = authPayload.sub as string | undefined;
    if (!authId) return null;
    const user = await prisma.user.findUnique({ where: { authId }, select: { id: true } });
    return user?.id ?? null;
}

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
                project: { select: { userId: true } },
                testRuns: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    select: { id: true, status: true, createdAt: true }
                },
                files: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (testCase.project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { project: _project, ...testCaseData } = testCase;
        const parsedTestCase = {
            ...testCaseData,
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

        const existingTestCase = await prisma.testCase.findUnique({
            where: { id },
            include: { project: { select: { userId: true } } }
        });

        if (!existingTestCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (existingTestCase.project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

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

        const existingTestCase = await prisma.testCase.findUnique({
            where: { id },
            include: { project: { select: { userId: true } } }
        });

        if (!existingTestCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (existingTestCase.project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await prisma.testCase.delete({
            where: { id },
        });

        const uploadPath = getUploadPath(id);
        try {
            await fs.rm(uploadPath, { recursive: true, force: true });
        } catch {
            console.warn(`Failed to delete upload directory: ${uploadPath}`);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete test case:', error);
        return NextResponse.json({ error: 'Failed to delete test case' }, { status: 500 });
    }
}

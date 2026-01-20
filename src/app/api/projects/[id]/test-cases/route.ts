import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { TestStep } from '@/types';

const logger = createLogger('api:projects:test-cases');

export const dynamic = 'force-dynamic';

function cleanStepsForStorage(steps: TestStep[]): TestStep[] {
    return steps.map(({ aiAction: _aiAction, codeAction: _codeAction, ...step }) => step);
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
        const project = await prisma.project.findUnique({ where: { id }, select: { userId: true } });
        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

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
        logger.error('Failed to fetch test cases', error);
        return NextResponse.json({ error: 'Failed to fetch test cases' }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const project = await prisma.project.findUnique({ where: { id }, select: { userId: true } });
        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body: unknown = await request.json();
        const { name, url, prompt, steps, browserConfig, username, password, displayId, saveDraft } = (body ?? {}) as {
            name?: string;
            url?: string;
            prompt?: string;
            steps?: unknown;
            browserConfig?: unknown;
            username?: string;
            password?: string;
            displayId?: string;
            saveDraft?: boolean;
        };

        const hasSteps = Array.isArray(steps) && steps.length > 0;
        const hasBrowserConfig = !!browserConfig && typeof browserConfig === 'object' && !Array.isArray(browserConfig) && Object.keys(browserConfig as Record<string, unknown>).length > 0;
        const cleanedSteps = hasSteps ? cleanStepsForStorage(steps as TestStep[]) : undefined;

        if (!name) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }
        if (!saveDraft && (!url || (!prompt && !hasSteps))) {
            return NextResponse.json({ error: 'Name, URL, and either Prompt or Steps are required' }, { status: 400 });
        }

        const testCase = await prisma.testCase.create({
            data: {
                name,
                url: url || '',
                prompt,
                steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
                browserConfig: hasBrowserConfig ? JSON.stringify(browserConfig) : undefined,
                username,
                password,
                projectId: id,
                displayId: displayId || undefined,
                status: 'DRAFT',
            },
        });

        return NextResponse.json(testCase);
    } catch (error) {
        logger.error('Failed to create test case', error);
        return NextResponse.json({ error: 'Failed to create test case' }, { status: 500 });
    }
}

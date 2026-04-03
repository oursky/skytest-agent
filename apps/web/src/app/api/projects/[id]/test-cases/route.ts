import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { cleanStepsForStorage } from '@/lib/runtime/test-case-utils';
import { TEST_STATUS, type TestStep } from '@/types';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';

const logger = createLogger('api:projects:test-cases');

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;

        const testCases = await prisma.testCase.findMany({
            where: { projectId: id },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                displayId: true,
                status: true,
                name: true,
                updatedAt: true,
                testRuns: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        status: true,
                        createdAt: true,
                    },
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
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;

        const body: unknown = await request.json();
        const { name, url, prompt, steps, browserConfig, displayId, saveDraft } = (body ?? {}) as {
            name?: string;
            url?: string;
            prompt?: string;
            steps?: unknown;
            browserConfig?: unknown;
            displayId?: string;
            saveDraft?: boolean;
        };

        const hasSteps = Array.isArray(steps) && steps.length > 0;
        const hasBrowserConfig = !!browserConfig && typeof browserConfig === 'object' && !Array.isArray(browserConfig) && Object.keys(browserConfig as Record<string, unknown>).length > 0;
        const cleanedSteps = hasSteps ? cleanStepsForStorage(steps as TestStep[]) : undefined;
        const normalizedDisplayId = typeof displayId === 'string' ? displayId.trim() : '';

        if (!name) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }
        if (!normalizedDisplayId) {
            return NextResponse.json({ error: 'Test case ID is required' }, { status: 400 });
        }
        if (!saveDraft && ((!url && !hasBrowserConfig) || (!prompt && !hasSteps))) {
            return NextResponse.json({ error: 'Name, and either URL or BrowserConfig, and either Prompt or Steps are required' }, { status: 400 });
        }

        const testCase = await prisma.testCase.create({
            data: {
                name,
                url: url || '',
                prompt,
                steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
                browserConfig: hasBrowserConfig ? JSON.stringify(browserConfig) : undefined,
                projectId: id,
                displayId: normalizedDisplayId,
                status: TEST_STATUS.DRAFT,
            },
        });

        return NextResponse.json(testCase);
    } catch (error) {
        logger.error('Failed to create test case', error);
        return NextResponse.json({ error: 'Failed to create test case' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
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
                source: true,
                sourceHash: true,
            },
        });

        return NextResponse.json(testCases.map((testCase) => ({
            ...testCase,
            sourcePath: testCase.source,
            sourceHash: testCase.sourceHash,
        })));
    } catch (error) {
        logger.error('Failed to fetch test cases', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to fetch test cases' });
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
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Name is required' });
        }
        if (!normalizedDisplayId) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Test case ID is required' });
        }
        if (!saveDraft && ((!url && !hasBrowserConfig) || (!prompt && !hasSteps))) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Name, and either URL or BrowserConfig, and either Prompt or Steps are required' });
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

        return NextResponse.json({
            ...testCase,
            sourcePath: testCase.source,
            sourceHash: testCase.sourceHash,
        });
    } catch (error) {
        logger.error('Failed to create test case', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to create test case' });
    }
}

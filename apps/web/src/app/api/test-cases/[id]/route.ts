import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { parseTestCaseJson, cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import { BrowserConfig, TargetConfig, TEST_STATUS } from '@/types';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';
import { guardTestCaseRouteRequest } from '@/lib/security/test-case-route-access';

const logger = createLogger('api:test-cases:id');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTestCaseRouteRequest({
        request,
        params,
        query: {
            include: {
                testRuns: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    select: { id: true, status: true, createdAt: true }
                },
                files: {
                    orderBy: { createdAt: 'desc' }
                },
                project: {
                    select: {
                        teamId: true,
                        name: true,
                    },
                }
            }
        }
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const testCase = guard.testCase;

        const parsedTestCase = parseTestCaseJson(testCase);
        const { project, ...testCasePayload } = parsedTestCase;
        return NextResponse.json({
            ...testCasePayload,
            projectName: project.name,
            projectTeamId: project.teamId,
        });
    } catch (error) {
        logger.error('Failed to fetch test case', error);
        return NextResponse.json({ error: 'Failed to fetch test case' }, { status: 500 });
    }
}


export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTestCaseRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { testCaseId: id } = guard;
        const body = await request.json();
        const { name, url, prompt, steps, browserConfig, displayId, preserveStatus } = body as {
            name?: string;
            url?: string;
            prompt?: string;
            steps?: unknown;
            browserConfig?: unknown;
            displayId?: string;
            preserveStatus?: boolean;
        };
        const normalizedDisplayId = typeof displayId === 'string' ? displayId.trim() : '';

        const existingTestCase = await prisma.testCase.findUnique({
            where: { id },
            include: {
                files: { select: { storedName: true } },
                configs: {
                    where: { type: 'FILE' },
                    select: { value: true }
                }
            }
        });

        if (!existingTestCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (!normalizedDisplayId) {
            return NextResponse.json({ error: 'Test case ID is required' }, { status: 400 });
        }

        const hasSteps = steps && Array.isArray(steps) && steps.length > 0;
        const hasBrowserConfig = browserConfig && Object.keys(browserConfig).length > 0;
        const cleanedSteps = hasSteps ? cleanStepsForStorage(steps) : undefined;
        const normalizedBrowserConfig = hasBrowserConfig
            ? normalizeTargetConfigMap(browserConfig as Record<string, BrowserConfig | TargetConfig>)
            : undefined;

        const updateData: Record<string, unknown> = {
            name,
            url,
            prompt,
            steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
            browserConfig: normalizedBrowserConfig ? JSON.stringify(normalizedBrowserConfig) : undefined,
            displayId: normalizedDisplayId,
        };

        if (preserveStatus !== true) {
            updateData.status = TEST_STATUS.DRAFT;
        }

        const testCase = await prisma.testCase.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json(testCase);
    } catch (error) {
        logger.error('Failed to update test case', error);
        return NextResponse.json({ error: 'Failed to update test case' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTestCaseRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { testCaseId: id } = guard;

        const existingTestCase = await prisma.testCase.findUnique({
            where: { id },
            include: {
                files: { select: { storedName: true } },
                configs: {
                    where: { type: 'FILE' },
                    select: { value: true }
                }
            }
        });

        if (!existingTestCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        await prisma.testCase.delete({
            where: { id },
        });

        const objectKeys = [
            ...existingTestCase.files.map((file) => file.storedName),
            ...existingTestCase.configs.map((config) => config.value),
        ];

        await Promise.all(objectKeys.map(async (objectKey) => {
            try {
                await deleteObjectIfExists(objectKey);
            } catch {
                logger.warn('Failed to delete object from storage', { objectKey });
            }
        }));

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete test case', error);
        return NextResponse.json({ error: 'Failed to delete test case' }, { status: 500 });
    }
}

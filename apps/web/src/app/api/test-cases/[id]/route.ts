import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { parseTestCaseJson, cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import { BrowserConfig, TargetConfig, TEST_STATUS } from '@/types';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';
import { isProjectMember } from '@/lib/security/permissions';

const logger = createLogger('api:test-cases:id');

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
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const testCase = await prisma.testCase.findUnique({
            where: { id },
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
                        team: {
                            select: {
                                memberships: {
                                    where: { userId },
                                    select: { id: true },
                                    take: 1,
                                }
                            }
                        }
                    },
                }
            }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.team.memberships.length === 0) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

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
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
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

        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!await isProjectMember(userId, existingTestCase.projectId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

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

        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!await isProjectMember(userId, existingTestCase.projectId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

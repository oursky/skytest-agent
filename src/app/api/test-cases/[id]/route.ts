import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { decrypt, encrypt } from '@/lib/crypto';
import { createLogger } from '@/lib/logger';
import { parseTestCaseJson } from '@/lib/test-case-utils';
import { TestStep } from '@/types';
import { getUploadPath, getTestCaseConfigUploadPath } from '@/lib/file-security';
import fs from 'fs/promises';

const logger = createLogger('api:test-cases:id');

function cleanStepsForStorage(steps: TestStep[]): TestStep[] {
    return steps.map((step) => {
        const { aiAction, codeAction, ...cleanedStep } = step;
        void aiAction;
        void codeAction;
        return cleanedStep;
    });
}

function decryptStoredCredential(value?: string | null): string | undefined {
    if (!value) return undefined;
    try {
        return decrypt(value);
    } catch {
        return value;
    }
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

        const { project, ...testCaseData } = testCase;
        void project;
        const parsedTestCase = parseTestCaseJson(testCaseData);
        parsedTestCase.username = decryptStoredCredential(testCaseData.username) ?? null;
        parsedTestCase.password = decryptStoredCredential(testCaseData.password) ?? null;

        return NextResponse.json(parsedTestCase);
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
        const { name, url, prompt, steps, browserConfig, username, password, displayId, saveDraft } = body;

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
        const encryptedUsername = username === undefined ? undefined : (username ? encrypt(username) : null);
        const encryptedPassword = password === undefined ? undefined : (password ? encrypt(password) : null);

        const updateData: Record<string, unknown> = {
            name,
            url,
            prompt,
            steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
            browserConfig: hasBrowserConfig ? JSON.stringify(browserConfig) : undefined,
            username: encryptedUsername,
            password: encryptedPassword,
        };

        if (displayId !== undefined) {
            updateData.displayId = displayId || null;
        }

        if (saveDraft) {
            updateData.status = 'DRAFT';
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

        const cleanupPaths = [getUploadPath(id), getTestCaseConfigUploadPath(id)];
        await Promise.all(cleanupPaths.map(async (cleanupPath) => {
            try {
                await fs.rm(cleanupPath, { recursive: true, force: true });
            } catch {
                logger.warn('Failed to delete upload directory', { cleanupPath });
            }
        }));

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete test case', error);
        return NextResponse.json({ error: 'Failed to delete test case' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import {
    buildTestCaseConfigObjectKey,
    buildTestCaseFileObjectKey,
    createStoredName,
} from '@/lib/security/file-security';
import { createLogger } from '@/lib/core/logger';
import { copyObject } from '@/lib/storage/object-store-utils';
import { isProjectMember } from '@/lib/security/permissions';
import { TEST_STATUS } from '@/types';

const logger = createLogger('api:test-cases:clone');

export const dynamic = 'force-dynamic';

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
        const existingTestCase = await prisma.testCase.findUnique({
            where: { id },
            include: {
                files: {
                    orderBy: { createdAt: 'desc' }
                },
                configs: {
                    orderBy: { createdAt: 'asc' }
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

        const clonedTestCase = await prisma.testCase.create({
            data: {
                name: `${existingTestCase.name} (Copy)`,
                url: existingTestCase.url,
                prompt: existingTestCase.prompt,
                steps: existingTestCase.steps,
                browserConfig: existingTestCase.browserConfig,
                projectId: existingTestCase.projectId,
                displayId: existingTestCase.displayId,
                status: TEST_STATUS.DRAFT,
            },
        });

        for (const file of existingTestCase.files) {
            const storedName = createStoredName(file.filename);
            const objectKey = buildTestCaseFileObjectKey(clonedTestCase.id, storedName);
            const copied = await copyObject({
                sourceKey: file.storedName,
                targetKey: objectKey,
                contentType: file.mimeType,
            });

            if (!copied) {
                logger.warn('clone: source test case file missing from object storage, skipping', {
                    testCaseId: existingTestCase.id,
                    fileId: file.id,
                    objectKey: file.storedName,
                });
                continue;
            }

            await prisma.testCaseFile.create({
                data: {
                    testCaseId: clonedTestCase.id,
                    filename: file.filename,
                    storedName: objectKey,
                    mimeType: file.mimeType,
                    size: file.size,
                }
            });
        }

        for (const testCaseConfig of existingTestCase.configs) {
            let value = testCaseConfig.value;

            if (testCaseConfig.type === 'FILE' && testCaseConfig.value) {
                const storedName = createStoredName(testCaseConfig.filename || testCaseConfig.name);
                const objectKey = buildTestCaseConfigObjectKey(clonedTestCase.id, storedName);
                const copied = await copyObject({
                    sourceKey: testCaseConfig.value,
                    targetKey: objectKey,
                    contentType: testCaseConfig.mimeType ?? undefined,
                });

                if (!copied) {
                    logger.warn('clone: source test case config file missing from object storage, skipping config', {
                        testCaseId: existingTestCase.id,
                        configId: testCaseConfig.id,
                        objectKey: testCaseConfig.value,
                    });
                    continue;
                }

                value = objectKey;
            }

            await prisma.testCaseConfig.create({
                data: {
                    testCaseId: clonedTestCase.id,
                    name: testCaseConfig.name,
                    type: testCaseConfig.type,
                    value,
                    masked: testCaseConfig.masked,
                    group: testCaseConfig.group,
                    filename: testCaseConfig.filename,
                    mimeType: testCaseConfig.mimeType,
                    size: testCaseConfig.size,
                }
            });
        }

        return NextResponse.json(clonedTestCase);
    } catch (error) {
        logger.error('Failed to clone test case', error);
        return NextResponse.json({ error: 'Failed to clone test case' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getFilePath, getTestCaseConfigUploadPath, getUploadPath } from '@/lib/file-security';
import fs from 'fs/promises';
import path from 'path';
import { config } from '@/config/app';

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
                project: { select: { userId: true } },
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

        if (existingTestCase.project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const clonedTestCase = await prisma.testCase.create({
            data: {
                name: `${existingTestCase.name} (Copy)`,
                url: existingTestCase.url,
                prompt: existingTestCase.prompt,
                steps: existingTestCase.steps,
                browserConfig: existingTestCase.browserConfig,
                username: existingTestCase.username,
                password: existingTestCase.password,
                projectId: existingTestCase.projectId,
                displayId: existingTestCase.displayId,
                status: 'DRAFT',
            },
        });

        const uploadRootRelative = config.files.uploadDir.replace(/^\.\//, '').replace(/\/$/, '');
        const uploadDirWithoutTrailingSlash = config.files.uploadDir.replace(/\/$/, '');
        const rewriteUploadPaths = (value: string | null | undefined) => {
            if (!value) return value;
            return value
                .split(`${uploadRootRelative}/${existingTestCase.id}/`).join(`${uploadRootRelative}/${clonedTestCase.id}/`)
                .split(`./${uploadRootRelative}/${existingTestCase.id}/`).join(`./${uploadRootRelative}/${clonedTestCase.id}/`)
                .split(`${uploadDirWithoutTrailingSlash}/${existingTestCase.id}/`).join(`${uploadDirWithoutTrailingSlash}/${clonedTestCase.id}/`)
                .split(`${uploadRootRelative}/testcase-configs/${existingTestCase.id}/`).join(`${uploadRootRelative}/testcase-configs/${clonedTestCase.id}/`)
                .split(`./${uploadRootRelative}/testcase-configs/${existingTestCase.id}/`).join(`./${uploadRootRelative}/testcase-configs/${clonedTestCase.id}/`)
                .split(`${uploadDirWithoutTrailingSlash}/testcase-configs/${existingTestCase.id}/`).join(`${uploadDirWithoutTrailingSlash}/testcase-configs/${clonedTestCase.id}/`);
        };

        const rewrittenPrompt = rewriteUploadPaths(existingTestCase.prompt);
        const rewrittenSteps = rewriteUploadPaths(existingTestCase.steps);
        if (rewrittenPrompt !== existingTestCase.prompt || rewrittenSteps !== existingTestCase.steps) {
            await prisma.testCase.update({
                where: { id: clonedTestCase.id },
                data: {
                    prompt: rewrittenPrompt,
                    steps: rewrittenSteps,
                }
            });
        }

        if (existingTestCase.files && existingTestCase.files.length > 0) {
            const newUploadDir = getUploadPath(clonedTestCase.id);
            await fs.mkdir(newUploadDir, { recursive: true });

            for (const file of existingTestCase.files) {
                const newStoredName = file.storedName;

                const src = getFilePath(existingTestCase.id, file.storedName);
                const dest = getFilePath(clonedTestCase.id, newStoredName);

                try {
                    await fs.link(src, dest);
                } catch {
                    try {
                        await fs.copyFile(src, dest);
                    } catch (copyError) {
                        logger.warn('clone: failed to copy/link file on disk, skipping', {
                            testCaseId: existingTestCase.id,
                            fileId: file.id,
                            src,
                            dest,
                            error: copyError,
                        });
                        continue;
                    }
                }

                await prisma.testCaseFile.create({
                    data: {
                        testCaseId: clonedTestCase.id,
                        filename: file.filename,
                        storedName: newStoredName,
                        mimeType: file.mimeType,
                        size: file.size,
                    }
                });
            }
        }

        if (existingTestCase.configs && existingTestCase.configs.length > 0) {
            const oldConfigUploadDir = getTestCaseConfigUploadPath(existingTestCase.id);
            const newConfigUploadDir = getTestCaseConfigUploadPath(clonedTestCase.id);
            await fs.mkdir(newConfigUploadDir, { recursive: true });

            const copiedConfigFileStoredNames = new Set<string>();

            for (const testCaseConfig of existingTestCase.configs) {
                if (testCaseConfig.type === 'FILE' && testCaseConfig.value) {
                    if (!copiedConfigFileStoredNames.has(testCaseConfig.value)) {
                        const src = path.join(oldConfigUploadDir, testCaseConfig.value);
                        const dest = path.join(newConfigUploadDir, testCaseConfig.value);

                        try {
                            await fs.link(src, dest);
                        } catch {
                            try {
                                await fs.copyFile(src, dest);
                            } catch (copyError) {
                                logger.warn('clone: failed to copy/link test case config file on disk, skipping config', {
                                    testCaseId: existingTestCase.id,
                                    configId: testCaseConfig.id,
                                    src,
                                    dest,
                                    error: copyError,
                                });
                                continue;
                            }
                        }

                        copiedConfigFileStoredNames.add(testCaseConfig.value);
                    }
                }

                await prisma.testCaseConfig.create({
                    data: {
                        testCaseId: clonedTestCase.id,
                        name: testCaseConfig.name,
                        type: testCaseConfig.type,
                        value: testCaseConfig.value,
                        filename: testCaseConfig.filename,
                        mimeType: testCaseConfig.mimeType,
                        size: testCaseConfig.size,
                    }
                });
            }
        }

        return NextResponse.json(clonedTestCase);
    } catch (error) {
        logger.error('Failed to clone test case', error);
        return NextResponse.json({ error: 'Failed to clone test case' }, { status: 500 });
    }
}

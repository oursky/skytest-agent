import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { dump as dumpYaml, load as parseYaml } from 'js-yaml';
import { readFile } from 'node:fs/promises';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { parseTestCaseJson, cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import { BrowserConfig, TargetConfig, TEST_STATUS } from '@/types';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';
import { guardTestCaseRouteRequest } from '@/lib/security/test-case-route-access';
import { loadTestCatalog } from '@/lib/test-cases/catalog-loader';
import { writeCatalogCaseFile } from '@/lib/test-cases/catalog-writeback';

const logger = createLogger('api:test-cases:id');

function hashSourceDocument(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

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
            sourcePath: testCase.source,
            sourceHash: testCase.sourceHash,
        });
    } catch (error) {
        logger.error('Failed to fetch test case', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to fetch test case' });
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
        const { name, url, prompt, steps, browserConfig, displayId, preserveStatus, expectedHash } = body as {
            name?: string;
            url?: string;
            prompt?: string;
            steps?: unknown;
            browserConfig?: unknown;
            displayId?: string;
            preserveStatus?: boolean;
            expectedHash?: string;
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
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Test case not found' });
        }

        if (!normalizedDisplayId) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Test case ID is required' });
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

        if (existingTestCase.source) {
            try {
                let sourcePath = existingTestCase.source;
                try {
                    const { catalog } = await loadTestCatalog(process.cwd());
                    const catalogEntry = catalog.get(normalizedDisplayId);
                    if (!catalogEntry || catalogEntry.sourcePath !== existingTestCase.source) {
                        return apiError({
                            status: 409,
                            code: 'VALIDATION_ERROR',
                            error: 'Source mapping is stale; refresh test cases and retry update',
                        });
                    }
                    sourcePath = catalogEntry.sourcePath;
                } catch (catalogError) {
                    logger.warn('Falling back to persisted source path for source-backed test case update', {
                        testCaseId: id,
                        displayId: normalizedDisplayId,
                        sourcePath: existingTestCase.source,
                        error: catalogError instanceof Error ? catalogError.message : String(catalogError),
                    });
                }

                const currentDocumentRaw = await readFile(sourcePath, 'utf8');
                const currentDocument = parseYaml(currentDocumentRaw) as Record<string, unknown>;
                const nextDocument = {
                    ...currentDocument,
                    id: normalizedDisplayId,
                    name: name ?? currentDocument.name,
                    url: url ?? currentDocument.url,
                    prompt: prompt ?? currentDocument.prompt,
                    steps: cleanedSteps ?? currentDocument.steps,
                    browserConfig: normalizedBrowserConfig ?? currentDocument.browserConfig,
                };
                const serializedNextDocument = dumpYaml(nextDocument, { lineWidth: 120 });
                const fallbackExpectedHash = hashSourceDocument(currentDocumentRaw);
                const writeResult = await writeCatalogCaseFile({
                    sourcePath,
                    expectedHash: typeof expectedHash === 'string' ? expectedHash : (existingTestCase.sourceHash ?? fallbackExpectedHash),
                    nextDocument: serializedNextDocument,
                });

                const updated = await prisma.testCase.update({
                    where: { id },
                    data: {
                        ...updateData,
                        source: sourcePath,
                        sourceHash: writeResult.sourceHash,
                    },
                });

                return NextResponse.json({
                    ...updated,
                    sourcePath: updated.source,
                    sourceHash: updated.sourceHash,
                });
            } catch (error) {
                if (error instanceof Error && error.message.includes('Source conflict')) {
                    return apiError({
                        status: 409,
                        code: 'VALIDATION_ERROR',
                        error: error.message,
                    });
                }
                throw error;
            }
        }

        const testCase = await prisma.testCase.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json({
            ...testCase,
            sourcePath: testCase.source,
            sourceHash: testCase.sourceHash,
        });
    } catch (error) {
        logger.error('Failed to update test case', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to update test case' });
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
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Test case not found' });
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
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to delete test case' });
    }
}

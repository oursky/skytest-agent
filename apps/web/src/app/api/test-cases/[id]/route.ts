import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { dump as dumpYaml, load as parseYaml } from 'js-yaml';
import { readFile } from 'node:fs/promises';
import { apiError } from '@/lib/security/api-route-standards';
import { config } from '@/config/app';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { parseTestCaseJson, cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import { BrowserConfig, TargetConfig, TEST_CASE_KIND, TEST_STATUS, type TestCaseKind } from '@/types';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';
import { guardTestCaseRouteRequest } from '@/lib/security/test-case-route-access';
import { loadTestCatalog } from '@/lib/test-cases/catalog-loader';
import { validateLoginFlowReferences } from '@/lib/test-cases/login-flow-access';
import { writeCatalogCaseFile } from '@/lib/test-cases/catalog-writeback';
import { resolveRuntimeRootFromSourcePath } from '@/lib/test-cases/source-path-utils';

const logger = createLogger('api:test-cases:id');

function parseTestCaseKind(value: string | null | undefined): TestCaseKind {
    return value === TEST_CASE_KIND.LOGIN_FLOW ? TEST_CASE_KIND.LOGIN_FLOW : TEST_CASE_KIND.TEST;
}

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
        const { name, url, prompt, steps, browserConfig, displayId, kind: rawKind, preserveStatus, expectedHash } = body as {
            name?: string;
            url?: string;
            prompt?: string;
            steps?: unknown;
            browserConfig?: unknown;
            displayId?: string;
            kind?: string;
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
                },
                _count: { select: { testGroupItems: true, testGroupLoginSessions: true } }
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
        const resolvedKind = parseTestCaseKind(rawKind ?? existingTestCase.kind);

        // A test group references a TEST as an item and a LOGIN_FLOW as a login session;
        // flipping the kind out from under that wiring would let queueTestGroupRun enqueue
        // the case as the wrong member type. Reject the flip while the case is still grouped.
        if (resolvedKind !== existingTestCase.kind
            && (existingTestCase._count.testGroupItems > 0 || existingTestCase._count.testGroupLoginSessions > 0)) {
            return apiError({
                status: 409,
                code: 'CONFLICT',
                error: 'Cannot change the kind of a test case that belongs to a test group. Remove it from its group(s) first.',
            });
        }

        if (normalizedBrowserConfig) {
            const loginFlowValidation = await validateLoginFlowReferences({
                projectId: existingTestCase.projectId,
                hostKind: resolvedKind,
                testCaseId: id,
                browserConfig: normalizedBrowserConfig,
            });
            if (!loginFlowValidation.ok) {
                return apiError({ status: 400, code: 'VALIDATION_ERROR', error: loginFlowValidation.error });
            }
        }

        const updateData: Record<string, unknown> = {
            name,
            url,
            prompt,
            steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
            browserConfig: normalizedBrowserConfig ? JSON.stringify(normalizedBrowserConfig) : undefined,
            displayId: normalizedDisplayId,
            kind: resolvedKind,
        };

        if (preserveStatus !== true) {
            updateData.status = TEST_STATUS.DRAFT;
        }

        const sourceRuntimeRoot = resolveRuntimeRootFromSourcePath(existingTestCase.source);
        if (sourceRuntimeRoot) {
            try {
                const sourcePathFromDb = existingTestCase.source;
                if (!sourcePathFromDb) {
                    return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Source-backed test case path is missing' });
                }
                let sourcePath = sourcePathFromDb;
                try {
                    const { catalog } = await loadTestCatalog(config.runtime.rootDir);
                    const catalogEntry = catalog.get(normalizedDisplayId);
                    if (!catalogEntry || catalogEntry.sourcePath !== sourcePathFromDb) {
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
                        sourcePath: sourcePathFromDb,
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

        if (existingTestCase.source) {
            updateData.source = null;
            updateData.sourceHash = null;
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

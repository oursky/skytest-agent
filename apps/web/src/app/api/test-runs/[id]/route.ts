import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { isTestEvent } from '@/lib/runtime/test-events';
import { objectStore } from '@/lib/storage/object-store';
import { isRunActiveStatus, isScreenshotData, type TestEvent, type LogLevel } from '@/types';
import { parseTestResultMetadata } from '@/lib/runtime/test-result-metadata';
import { loadMaskedVariableValuesForTestCase } from '@/lib/runtime/masked-variables';
import { createExactValueMasker, maskEventForViewer, maskNullableText } from '@/lib/runtime/log-masking';
import { guardTestRunRouteRequest } from '@/lib/security/test-run-route-access';
import { apiError } from '@/lib/security/api-route-standards';

const logger = createLogger('api:test-runs:id');

interface RunEventRow {
    kind: string;
    message: string | null;
    payload: unknown;
    artifactKey: string | null;
    createdAt: Date;
}

function isLogLevel(value: unknown): value is LogLevel {
    return value === 'info' || value === 'error' || value === 'success';
}

function resolveArtifactFilename(artifactKey: string): string {
    const segments = artifactKey.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'artifact.bin';
}

function createArtifactUnavailableLogEvent(
    row: RunEventRow,
    maskText: (text: string) => string
): TestEvent {
    return {
        type: 'log',
        data: {
            message: maskText(row.message || `Screenshot artifact unavailable: ${row.artifactKey ?? 'unknown artifact'}`),
            level: 'error',
        },
        timestamp: row.createdAt.getTime(),
    };
}

async function mapRunEventToUiEvent(
    row: RunEventRow,
    maskText: (text: string) => string
): Promise<TestEvent> {
    if (isTestEvent(row.payload)) {
        const maskedPayload = maskEventForViewer(row.payload, maskText);
        if (
            maskedPayload.type === 'screenshot'
            && isScreenshotData(maskedPayload.data)
            && maskedPayload.data.src.startsWith('artifact:')
        ) {
            if (!row.artifactKey) {
                return createArtifactUnavailableLogEvent(row, maskText);
            }

            try {
                const signedUrl = await objectStore.getSignedDownloadUrl({
                    key: row.artifactKey,
                    filename: resolveArtifactFilename(row.artifactKey),
                    inline: true,
                });

                return {
                    ...maskedPayload,
                    data: {
                        ...maskedPayload.data,
                        src: signedUrl,
                    },
                };
            } catch (error) {
                logger.warn('Failed to resolve signed artifact URL for history run event', error);
                return createArtifactUnavailableLogEvent(row, maskText);
            }
        }

        return maskedPayload;
    }

    const level: LogLevel = row.kind.toLowerCase().includes('error') ? 'error' : 'info';
    return {
        type: 'log',
        data: {
            message: maskText(row.message || (row.artifactKey ? `Artifact uploaded: ${row.artifactKey}` : row.kind)),
            level: isLogLevel(level) ? level : 'info',
        },
        timestamp: row.createdAt.getTime(),
    };
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTestRunRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;

        const testRun = await prisma.testRun.findUnique({
            where: { id },
            include: {
                files: true,
                testCase: {
                    select: {
                        id: true,
                        projectId: true,
                        displayId: true,
                        name: true,
                        url: true,
                        prompt: true,
                        steps: true,
                        browserConfig: true,
                        project: {
                            select: {
                                name: true,
                                teamId: true,
                            }
                        }
                    }
                }
            }
        });

        if (!testRun || testRun.deletedAt) {
            return apiError({
                status: 404,
                code: 'NOT_FOUND',
                error: 'Test run not found',
            });
        }

        const maskedVariableValues = await loadMaskedVariableValuesForTestCase(
            testRun.testCase.projectId,
            testRun.testCaseId
        );
        const maskText = createExactValueMasker(maskedVariableValues);

        const files = testRun.files || [];
        const eventRows = await prisma.testRunEvent.findMany({
            where: { runId: id },
            orderBy: { sequence: 'asc' },
            select: {
                kind: true,
                message: true,
                payload: true,
                artifactKey: true,
                createdAt: true,
            },
        });
        const events: TestEvent[] = await Promise.all(
            eventRows.map((eventRow) => mapRunEventToUiEvent(eventRow, maskText))
        );
        const resultMetadata = parseTestResultMetadata(testRun.result);

        return NextResponse.json({
            id: testRun.id,
            status: testRun.status,
            result: maskNullableText(testRun.result, maskText),
            logs: maskNullableText(testRun.logs, maskText),
            error: maskNullableText(testRun.error, maskText),
            errorCode: resultMetadata.errorCode,
            errorCategory: resultMetadata.errorCategory,
            configurationSnapshot: testRun.configurationSnapshot,
            startedAt: testRun.startedAt,
            completedAt: testRun.completedAt,
            createdAt: testRun.createdAt,
            testCaseId: testRun.testCaseId,
            testCaseDisplayId: testRun.testCase.displayId,
            testCaseName: testRun.testCase.name,
            testCaseUrl: testRun.testCase.url,
            testCasePrompt: testRun.testCase.prompt,
            testCaseSteps: testRun.testCase.steps,
            testCaseBrowserConfig: testRun.testCase.browserConfig,
            projectId: testRun.testCase.projectId,
            projectName: testRun.testCase.project.name,
            projectTeamId: testRun.testCase.project.teamId,
            triggeredByEmail: testRun.triggeredByEmail,
            instanceId: testRun.instanceId,
            instanceType: testRun.instanceType,
            instanceName: testRun.instanceName,
            files,
            events,
        });
    } catch (error) {
        logger.error('Failed to fetch test run', error);
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to fetch test run',
        });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTestRunRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;

        const testRun = await prisma.testRun.findUnique({
            where: { id },
            include: {
                testCase: {
                    select: { projectId: true }
                }
            }
        });

        if (!testRun || testRun.deletedAt) {
            return apiError({
                status: 404,
                code: 'NOT_FOUND',
                error: 'Test run not found',
            });
        }

        if (isRunActiveStatus(testRun.status)) {
            return apiError({
                status: 409,
                code: 'CONFLICT',
                error: 'Cannot delete an active test run',
            });
        }

        await prisma.testRun.update({
            where: { id },
            data: {
                deletedAt: new Date(),
            },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete test run', error);
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to delete test run',
        });
    }
}

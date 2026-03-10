import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isProjectMember } from '@/lib/security/permissions';
import { isTestEvent } from '@/lib/runtime/test-events';
import { objectStore } from '@/lib/storage/object-store';
import { isScreenshotData, type TestEvent, type LogLevel } from '@/types';
import { parseTestResultMetadata } from '@/lib/runtime/test-result-metadata';
import { loadMaskedVariableValuesForTestCase } from '@/lib/runtime/masked-variables';
import { createExactValueMasker, maskEventForViewer, maskNullableText } from '@/lib/runtime/log-masking';

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

        const testRun = await prisma.testRun.findUnique({
            where: { id },
            include: {
                files: true,
                testCase: {
                    select: {
                        id: true,
                        projectId: true,
                    }
                }
            }
        });

        if (!testRun || testRun.deletedAt) {
            return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
        }

        if (!await isProjectMember(userId, testRun.testCase.projectId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
            files,
            events,
        });
    } catch (error) {
        logger.error('Failed to fetch test run', error);
        return NextResponse.json({ error: 'Failed to fetch test run' }, { status: 500 });
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
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const testRun = await prisma.testRun.findUnique({
            where: { id },
            include: {
                testCase: {
                    select: { projectId: true }
                }
            }
        });

        if (!testRun || testRun.deletedAt) {
            return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
        }

        if (!await isProjectMember(userId, testRun.testCase.projectId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (['RUNNING', 'QUEUED', 'PREPARING'].includes(testRun.status)) {
            return NextResponse.json({ error: 'Cannot delete an active test run' }, { status: 409 });
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
        return NextResponse.json({ error: 'Failed to delete test run' }, { status: 500 });
    }
}

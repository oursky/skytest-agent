import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { isTestEvent } from '@/lib/runtime/test-events';
import { objectStore } from '@/lib/storage/object-store';
import { isRunActiveStatus, isScreenshotData, TEST_CASE_KIND, type TestEvent, type LogLevel, type BrowserConfig, type TargetConfig, type TestStep, type LoginFlowPrefixInfo } from '@/types';
import { parseTestResultMetadata } from '@/lib/runtime/test-result-metadata';
import { loadMaskedVariableValuesForTestCase } from '@/lib/runtime/masked-variables';
import { createExactValueMasker, maskEventForViewer, maskNullableText } from '@/lib/runtime/log-masking';
import { guardTestRunRouteRequest } from '@/lib/security/test-run-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { parseSerializedJson } from '@/lib/runtime/local-browser-runner-parsers';

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

        // Login-flow prefixes that run before this test in the same session. Surfaced so
        // a QUEUED test reads as "waiting for its login flow(s)" rather than just queued.
        let loginFlowPrefixes: LoginFlowPrefixInfo[] = [];
        if (testRun.runSessionId && testRun.sessionPosition != null) {
            const prefixRuns = await prisma.testRun.findMany({
                where: {
                    runSessionId: testRun.runSessionId,
                    kind: TEST_CASE_KIND.LOGIN_FLOW,
                    sessionPosition: { lt: testRun.sessionPosition },
                },
                orderBy: { sessionPosition: 'asc' },
                select: { id: true, status: true, testCaseId: true, testCase: { select: { displayId: true, name: true } } },
            });
            loginFlowPrefixes = prefixRuns.map((prefix) => ({
                runId: prefix.id,
                testCaseId: prefix.testCaseId,
                displayId: prefix.testCase.displayId,
                name: prefix.testCase.name,
                status: prefix.status,
            }));
        }

        return NextResponse.json({
            id: testRun.id,
            status: testRun.status,
            runSessionId: testRun.runSessionId,
            loginFlowPrefixes,
            result: maskNullableText(testRun.result, maskText),
            logs: maskNullableText(testRun.logs, maskText),
            error: maskNullableText(testRun.error, maskText),
            slackNotifyError: testRun.slackNotifyError,
            errorCode: resultMetadata.errorCode,
            errorCategory: resultMetadata.errorCategory,
            actionCount: resultMetadata.actionCount,
            configurationSnapshot: testRun.configurationSnapshot,
            startedAt: testRun.startedAt,
            completedAt: testRun.completedAt,
            createdAt: testRun.createdAt,
            lastEventAt: testRun.lastEventAt,
            leaseExpiresAt: testRun.leaseExpiresAt,
            assignedRunnerId: testRun.assignedRunnerId,
            requiredCapability: testRun.requiredCapability,
            requiredRunnerKind: testRun.requiredRunnerKind,
            requestedDeviceId: testRun.requestedDeviceId,
            requestedRunnerId: testRun.requestedRunnerId,
            testCaseId: testRun.testCaseId,
            testCaseDisplayId: testRun.testCase.displayId,
            testCaseName: testRun.testCase.name,
            testCaseUrl: testRun.testCase.url,
            testCasePrompt: testRun.testCase.prompt,
            testCaseSteps: parseSerializedJson<TestStep[]>(testRun.testCase.steps),
            testCaseBrowserConfig: parseSerializedJson<Record<string, BrowserConfig | TargetConfig>>(testRun.testCase.browserConfig),
            projectId: testRun.testCase.projectId,
            projectName: testRun.testCase.project.name,
            projectTeamId: testRun.testCase.project.teamId,
            triggeredByEmail: testRun.triggeredByEmail,
            triggerSource: testRun.triggerSource,
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

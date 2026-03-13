import type { RunnerEventInput } from '@skytest/runner-protocol';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { config as appConfig } from '@/config/app';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { createStoredName, validateAndSanitizeFile, buildRunArtifactObjectKey } from '@/lib/security/file-security';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';
import { UsageService } from '@/lib/runtime/usage';
import { dispatchNextQueuedBrowserRun } from '@/lib/runtime/browser-run-dispatcher';
import { TEST_STATUS, isRunInProgressStatus } from '@/types';

const logger = createLogger('runners:event-service');

interface OwnedRun {
    id: string;
    testCaseId: string;
    status: string;
    requestedDeviceId: string | null;
    deletedAt: Date | null;
    assignedRunnerId: string | null;
    leaseExpiresAt: Date | null;
    nextEventSequence: number;
}

function createLeaseExpiry(now = new Date()): Date {
    return new Date(now.getTime() + appConfig.runner.leaseDurationSeconds * 1000);
}

function shouldPromoteRunToRunning(events: RunnerEventInput[]): boolean {
    return events.some((event) => {
        if (event.kind.trim().toUpperCase() !== 'STATUS') {
            return false;
        }
        const message = event.message?.trim().toLowerCase() ?? '';
        return message.includes('running test steps');
    });
}

function ensureRunOwnership<T extends OwnedRun>(run: T | null, runnerId: string): T | null {
    if (!run) {
        return null;
    }
    if (run.deletedAt) {
        return null;
    }
    if (run.assignedRunnerId !== runnerId) {
        return null;
    }
    if (!run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= Date.now()) {
        return null;
    }
    if (!isRunInProgressStatus(run.status)) {
        return null;
    }

    return run;
}

async function findOwnedRun(runId: string, runnerId: string): Promise<OwnedRun | null> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            testCaseId: true,
            status: true,
            requestedDeviceId: true,
            deletedAt: true,
            assignedRunnerId: true,
            leaseExpiresAt: true,
            nextEventSequence: true,
        },
    });

    return ensureRunOwnership(run, runnerId);
}

async function recordRunUsageIfAvailable(input: {
    testCaseId: string;
    runId: string;
    result?: string;
}) {
    try {
        const testCase = await prisma.testCase.findUnique({
            where: { id: input.testCaseId },
            select: {
                name: true,
                project: {
                    select: {
                        id: true,
                        name: true,
                        createdByUserId: true,
                    }
                }
            }
        });

        if (!testCase) {
            return;
        }

        await UsageService.recordRunUsageFromResult({
            actorUserId: testCase.project.createdByUserId,
            projectId: testCase.project.id,
            result: input.result,
            description: `${testCase.project.name} - ${testCase.name}`,
            testRunId: input.runId,
        });
    } catch {
        // Ignore usage recording failures to avoid blocking run state transitions.
    }
}

export async function appendRunEvents(input: {
    runId: string;
    runnerId: string;
    events: RunnerEventInput[];
}) {
    const now = new Date();

    const appended = await prisma.$transaction(async (tx) => {
        const run = await tx.testRun.findUnique({
            where: { id: input.runId },
            select: {
                id: true,
                testCaseId: true,
                status: true,
                requestedDeviceId: true,
                deletedAt: true,
                assignedRunnerId: true,
                leaseExpiresAt: true,
                nextEventSequence: true,
            },
        });
        const ownedRun = ensureRunOwnership(run, input.runnerId);
        if (!ownedRun) {
            return null;
        }

        if (ownedRun.requestedDeviceId) {
            const lockCount = await tx.androidResourceLock.count({
                where: {
                    runId: input.runId,
                    runnerId: input.runnerId,
                    leaseExpiresAt: { gt: now },
                },
            });
            if (lockCount === 0) {
                return null;
            }
        }

        const startSequence = ownedRun.nextEventSequence;
        const nextLeaseExpiresAt = createLeaseExpiry(now);
        const runUpdateData: Prisma.TestRunUpdateManyMutationInput = {
            nextEventSequence: startSequence + input.events.length,
            lastEventAt: now,
            leaseExpiresAt: nextLeaseExpiresAt,
        };
        if (ownedRun.status === TEST_STATUS.PREPARING && shouldPromoteRunToRunning(input.events)) {
            runUpdateData.status = TEST_STATUS.RUNNING;
        }

        const updateResult = await tx.testRun.updateMany({
            where: {
                id: input.runId,
                assignedRunnerId: input.runnerId,
                nextEventSequence: startSequence,
            },
            data: runUpdateData,
        });

        if (updateResult.count !== 1) {
            throw new Error('Failed to reserve event sequence');
        }

        await tx.androidResourceLock.updateMany({
            where: {
                runId: input.runId,
                runnerId: input.runnerId,
            },
            data: {
                leaseExpiresAt: nextLeaseExpiresAt,
            },
        });

        await tx.testRunEvent.createMany({
            data: input.events.map((event, index) => ({
                runId: input.runId,
                sequence: startSequence + index,
                kind: event.kind,
                message: event.message ?? null,
                payload: event.payload as Prisma.InputJsonValue | undefined,
                artifactKey: event.artifactKey ?? null,
                createdAt: now,
            })),
        });

        return {
            accepted: input.events.length,
            nextSequence: startSequence + input.events.length,
        };
    });

    if (appended) {
        publishRunUpdate(input.runId);
    }

    return appended;
}

export async function uploadRunArtifact(input: {
    runId: string;
    runnerId: string;
    filename: string;
    mimeType: string;
    contentBase64: string;
}) {
    const ownedRun = await findOwnedRun(input.runId, input.runnerId);
    if (!ownedRun) {
        return null;
    }

    const body = Buffer.from(input.contentBase64, 'base64');
    if (body.length === 0 || body.length > appConfig.files.maxFileSize) {
        return null;
    }

    const validation = validateAndSanitizeFile(input.filename, input.mimeType, body.length);
    if (!validation.valid) {
        return null;
    }

    const storedName = validation.storedName ?? createStoredName(input.filename);
    const artifactKey = buildRunArtifactObjectKey(input.runId, storedName);

    await putObjectBuffer({
        key: artifactKey,
        body,
        contentType: input.mimeType,
    });

    const file = await prisma.testRunFile.create({
        data: {
            runId: input.runId,
            filename: validation.sanitizedFilename ?? input.filename,
            storedName: artifactKey,
            mimeType: input.mimeType,
            size: body.length,
        },
        select: {
            id: true,
        },
    });

    const result = {
        fileId: file.id,
        artifactKey,
    };
    publishRunUpdate(input.runId);
    return result;
}

export async function completeOwnedRun(input: {
    runId: string;
    runnerId: string;
    result?: string;
}) {
    const now = new Date();

    const completed = await prisma.$transaction(async (tx) => {
        const run = await tx.testRun.findUnique({
            where: { id: input.runId },
            select: {
                id: true,
                testCaseId: true,
                status: true,
                requestedDeviceId: true,
                deletedAt: true,
                assignedRunnerId: true,
                leaseExpiresAt: true,
                nextEventSequence: true,
            },
        });
        const ownedRun = ensureRunOwnership(run, input.runnerId);
        if (!ownedRun) {
            return null;
        }

        await tx.testRun.update({
            where: { id: input.runId },
            data: {
                status: TEST_STATUS.PASS,
                result: input.result,
                completedAt: now,
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });

        await tx.androidResourceLock.deleteMany({
            where: {
                runId: input.runId,
            },
        });

        await tx.testCase.update({
            where: { id: ownedRun.testCaseId },
            data: { status: TEST_STATUS.PASS },
        });

        return {
            runId: input.runId,
            status: TEST_STATUS.PASS,
            testCaseId: ownedRun.testCaseId,
        };
    });

    if (completed) {
        await recordRunUsageIfAvailable({
            testCaseId: completed.testCaseId,
            runId: completed.runId,
            result: input.result,
        });
        logger.info('Run marked PASS by runner', {
            runId: input.runId,
            runnerId: input.runnerId,
        });
        publishRunUpdate(input.runId);
        void dispatchNextQueuedBrowserRun().catch((dispatchError) => {
            logger.warn('Failed to dispatch queued browser run after runner completion', {
                runId: input.runId,
                error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
            });
        });
    } else {
        logger.warn('Ignored complete request for non-owned or expired run', {
            runId: input.runId,
            runnerId: input.runnerId,
        });
    }

    if (!completed) {
        return null;
    }

    return { runId: completed.runId, status: completed.status };
}

export async function failOwnedRun(input: {
    runId: string;
    runnerId: string;
    error: string;
    result?: string;
}) {
    const now = new Date();

    const failed = await prisma.$transaction(async (tx) => {
        const run = await tx.testRun.findUnique({
            where: { id: input.runId },
            select: {
                id: true,
                testCaseId: true,
                status: true,
                requestedDeviceId: true,
                deletedAt: true,
                assignedRunnerId: true,
                leaseExpiresAt: true,
                nextEventSequence: true,
            },
        });
        const ownedRun = ensureRunOwnership(run, input.runnerId);
        if (!ownedRun) {
            return null;
        }

        await tx.testRun.update({
            where: { id: input.runId },
            data: {
                status: TEST_STATUS.FAIL,
                error: input.error,
                result: input.result,
                completedAt: now,
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });

        await tx.androidResourceLock.deleteMany({
            where: {
                runId: input.runId,
            },
        });

        await tx.testCase.update({
            where: { id: ownedRun.testCaseId },
            data: { status: TEST_STATUS.FAIL },
        });

        return {
            runId: input.runId,
            status: TEST_STATUS.FAIL,
            testCaseId: ownedRun.testCaseId,
        };
    });

    if (failed) {
        await recordRunUsageIfAvailable({
            testCaseId: failed.testCaseId,
            runId: failed.runId,
            result: input.result,
        });
        logger.info('Run marked FAIL by runner', {
            runId: input.runId,
            runnerId: input.runnerId,
        });
        publishRunUpdate(input.runId);
        void dispatchNextQueuedBrowserRun().catch((dispatchError) => {
            logger.warn('Failed to dispatch queued browser run after runner failure', {
                runId: input.runId,
                error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
            });
        });
    } else {
        logger.warn('Ignored fail request for non-owned or expired run', {
            runId: input.runId,
            runnerId: input.runnerId,
        });
    }

    if (!failed) {
        return null;
    }

    return { runId: failed.runId, status: failed.status };
}

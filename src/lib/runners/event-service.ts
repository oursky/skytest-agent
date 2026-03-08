import type { RunnerEventInput } from '@skytest/runner-protocol';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { config as appConfig } from '@/config/app';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { createStoredName, validateAndSanitizeFile, buildRunArtifactObjectKey } from '@/lib/security/file-security';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';

const logger = createLogger('runners:event-service');

interface OwnedRun {
    id: string;
    testCaseId: string;
    status: string;
    assignedRunnerId: string | null;
    leaseExpiresAt: Date | null;
    nextEventSequence: number;
}

function ensureRunOwnership(run: OwnedRun | null, runnerId: string): OwnedRun | null {
    if (!run) {
        return null;
    }
    if (run.assignedRunnerId !== runnerId) {
        return null;
    }
    if (!run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= Date.now()) {
        return null;
    }
    if (!['PREPARING', 'RUNNING'].includes(run.status)) {
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
            assignedRunnerId: true,
            leaseExpiresAt: true,
            nextEventSequence: true,
        },
    });

    return ensureRunOwnership(run, runnerId);
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
                assignedRunnerId: true,
                leaseExpiresAt: true,
                nextEventSequence: true,
            },
        });
        const ownedRun = ensureRunOwnership(run, input.runnerId);
        if (!ownedRun) {
            return null;
        }

        const startSequence = ownedRun.nextEventSequence;
        const updateResult = await tx.testRun.updateMany({
            where: {
                id: input.runId,
                assignedRunnerId: input.runnerId,
                nextEventSequence: startSequence,
            },
            data: {
                nextEventSequence: startSequence + input.events.length,
                lastEventAt: now,
            },
        });

        if (updateResult.count !== 1) {
            throw new Error('Failed to reserve event sequence');
        }

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
                status: 'PASS',
                result: input.result,
                completedAt: now,
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });

        await tx.testCase.update({
            where: { id: ownedRun.testCaseId },
            data: { status: 'PASS' },
        });

        return { runId: input.runId, status: 'PASS' as const };
    });

    if (completed) {
        logger.info('Run marked PASS by runner', {
            runId: input.runId,
            runnerId: input.runnerId,
        });
        publishRunUpdate(input.runId);
    } else {
        logger.warn('Ignored complete request for non-owned or expired run', {
            runId: input.runId,
            runnerId: input.runnerId,
        });
    }

    return completed;
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
                status: 'FAIL',
                error: input.error,
                result: input.result,
                completedAt: now,
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });

        await tx.testCase.update({
            where: { id: ownedRun.testCaseId },
            data: { status: 'FAIL' },
        });

        return { runId: input.runId, status: 'FAIL' as const };
    });

    if (failed) {
        logger.info('Run marked FAIL by runner', {
            runId: input.runId,
            runnerId: input.runnerId,
        });
        publishRunUpdate(input.runId);
    } else {
        logger.warn('Ignored fail request for non-owned or expired run', {
            runId: input.runId,
            runnerId: input.runnerId,
        });
    }

    return failed;
}

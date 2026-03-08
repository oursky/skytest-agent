import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { prisma } from '@/lib/core/prisma';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';

const logger = createLogger('runners:run-retention');

const TERMINAL_STATUSES = ['PASS', 'FAIL', 'CANCELLED'] as const;

function daysAgo(now: Date, days: number): Date {
    return new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
}

interface HardDeleteCandidate {
    id: string;
    files: Array<{ storedName: string }>;
    events: Array<{ artifactKey: string | null }>;
}

function collectArtifactKeys(run: HardDeleteCandidate): string[] {
    const keys = new Set<string>();
    for (const file of run.files) {
        keys.add(file.storedName);
    }
    for (const event of run.events) {
        if (event.artifactKey) {
            keys.add(event.artifactKey);
        }
    }
    return [...keys];
}

export async function enforceRunArtifactRetention(now = new Date()) {
    const softDeleteCutoff = daysAgo(now, appConfig.runner.artifactSoftDeleteDays);
    const hardDeleteCutoff = daysAgo(now, appConfig.runner.artifactHardDeleteDays);

    const softDeleteResult = await prisma.testRun.updateMany({
        where: {
            deletedAt: null,
            status: { in: [...TERMINAL_STATUSES] },
            completedAt: {
                not: null,
                lt: softDeleteCutoff,
            },
        },
        data: {
            deletedAt: now,
        },
    });

    const hardDeleteCandidates = await prisma.testRun.findMany({
        where: {
            deletedAt: { lt: hardDeleteCutoff },
            status: { in: [...TERMINAL_STATUSES] },
        },
        orderBy: {
            deletedAt: 'asc',
        },
        take: appConfig.runner.artifactHardDeleteBatchSize,
        select: {
            id: true,
            files: {
                select: {
                    storedName: true,
                },
            },
            events: {
                where: {
                    artifactKey: { not: null },
                },
                select: {
                    artifactKey: true,
                },
            },
        },
    });

    let hardDeletedRuns = 0;
    let hardDeletedArtifacts = 0;
    let hardDeleteFailures = 0;

    for (const run of hardDeleteCandidates) {
        const artifactKeys = collectArtifactKeys(run);
        const deleteResults = await Promise.allSettled(artifactKeys.map(async (key) => {
            await deleteObjectIfExists(key);
            return key;
        }));
        const failedDeletes = deleteResults.filter((result) => result.status === 'rejected');
        hardDeletedArtifacts += deleteResults.length - failedDeletes.length;

        if (failedDeletes.length > 0) {
            hardDeleteFailures += 1;
            logger.warn('Failed to delete one or more run artifacts during retention', {
                runId: run.id,
                failedArtifactDeletes: failedDeletes.length,
            });
            continue;
        }

        try {
            await prisma.testRun.delete({
                where: { id: run.id },
            });
            hardDeletedRuns += 1;
        } catch (error) {
            hardDeleteFailures += 1;
            logger.warn('Failed to hard-delete retained test run', {
                runId: run.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        softDeletedRuns: softDeleteResult.count,
        hardDeletedRuns,
        hardDeletedArtifacts,
        hardDeleteFailures,
        softDeleteCutoff,
        hardDeleteCutoff,
    };
}

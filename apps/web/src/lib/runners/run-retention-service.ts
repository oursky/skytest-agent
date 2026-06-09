import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { prisma } from '@/lib/core/prisma';
import { objectStore } from '@/lib/storage/object-store';
import { RUN_TERMINAL_STATUSES } from '@/types';

const logger = createLogger('runners:run-retention');

function daysAgo(now: Date, days: number): Date {
    return new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
}

interface PurgeCandidate {
    id: string;
    files: Array<{ storedName: string }>;
    events: Array<{ artifactKey: string | null }>;
}

function collectArtifactKeys(run: PurgeCandidate): string[] {
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
    const retentionCutoff = daysAgo(now, appConfig.runner.artifactRetentionDays);

    const purgeCandidates = await prisma.testRun.findMany({
        where: {
            status: { in: [...RUN_TERMINAL_STATUSES] },
            OR: [
                {
                    completedAt: {
                        not: null,
                        lt: retentionCutoff,
                    },
                },
                {
                    deletedAt: { not: null },
                },
            ],
        },
        orderBy: {
            completedAt: 'asc',
        },
        take: appConfig.runner.artifactRetentionBatchSize,
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

    let purgedRuns = 0;
    let purgedArtifacts = 0;
    let purgeFailures = 0;

    for (const run of purgeCandidates) {
        const artifactKeys = collectArtifactKeys(run);
        let failedArtifactDeletes = 0;
        try {
            const { failedKeys } = await objectStore.deleteObjects(artifactKeys);
            failedArtifactDeletes = failedKeys.length;
            purgedArtifacts += artifactKeys.length - failedArtifactDeletes;
        } catch (error) {
            purgeFailures += 1;
            logger.warn('Failed to batch-delete run artifacts during retention', {
                runId: run.id,
                error: error instanceof Error ? error.message : String(error),
            });
            continue;
        }

        if (failedArtifactDeletes > 0) {
            purgeFailures += 1;
            logger.warn('Failed to delete one or more run artifacts during retention', {
                runId: run.id,
                failedArtifactDeletes,
            });
            continue;
        }

        try {
            await prisma.testRun.delete({
                where: { id: run.id },
            });
            purgedRuns += 1;
        } catch (error) {
            purgeFailures += 1;
            logger.warn('Failed to purge retained test run', {
                runId: run.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        purgedRuns,
        purgedArtifacts,
        purgeFailures,
        retentionCutoff,
    };
}

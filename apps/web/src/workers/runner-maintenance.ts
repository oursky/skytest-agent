import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { prisma } from '@/lib/core/prisma';
import { pruneOldRunEvents } from '@/lib/runners/event-retention-service';
import { reapExpiredRunnerLeases } from '@/lib/runners/lease-reaper';
import { failInvalidQueuedAndroidRuns } from '@/lib/runners/queue-sanitizer';
import { enforceRunArtifactRetention } from '@/lib/runners/run-retention-service';

const logger = createLogger('worker:runner-maintenance');
let shutdownRequested = false;
let wakeLoop: (() => void) | null = null;

function sleepOrWake(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            wakeLoop = null;
            resolve();
        }, ms);
        wakeLoop = () => {
            clearTimeout(timeout);
            wakeLoop = null;
            resolve();
        };
    });
}

async function runMaintenanceCycle() {
    const [leaseResult, retentionResult, queueSanitizerResult] = await Promise.all([
        reapExpiredRunnerLeases(),
        pruneOldRunEvents(),
        failInvalidQueuedAndroidRuns(),
    ]);
    const runRetentionResult = await enforceRunArtifactRetention();

    if (
        leaseResult.recoveredRuns > 0
        || retentionResult.deletedEvents > 0
        || queueSanitizerResult.failedRuns > 0
        || runRetentionResult.softDeletedRuns > 0
        || runRetentionResult.hardDeletedRuns > 0
        || runRetentionResult.hardDeleteFailures > 0
    ) {
        logger.info('Runner maintenance cycle completed', {
            recoveredRuns: leaseResult.recoveredRuns,
            requeuedRuns: leaseResult.requeuedRuns,
            failedRuns: leaseResult.failedRuns,
            deletedEvents: retentionResult.deletedEvents,
            retentionCutoff: retentionResult.cutoff.toISOString(),
            failedInvalidQueuedRuns: queueSanitizerResult.failedRuns,
            softDeletedRuns: runRetentionResult.softDeletedRuns,
            hardDeletedRuns: runRetentionResult.hardDeletedRuns,
            hardDeletedArtifacts: runRetentionResult.hardDeletedArtifacts,
            hardDeleteFailures: runRetentionResult.hardDeleteFailures,
            artifactSoftDeleteCutoff: runRetentionResult.softDeleteCutoff.toISOString(),
            artifactHardDeleteCutoff: runRetentionResult.hardDeleteCutoff.toISOString(),
        });
    }
}

async function main() {
    logger.info('Runner maintenance worker started', {
        leaseReaperIntervalMs: appConfig.runner.leaseReaperIntervalMs,
        eventRetentionDays: appConfig.runner.eventRetentionDays,
        artifactSoftDeleteDays: appConfig.runner.artifactSoftDeleteDays,
        artifactHardDeleteDays: appConfig.runner.artifactHardDeleteDays,
        artifactHardDeleteBatchSize: appConfig.runner.artifactHardDeleteBatchSize,
    });

    const runOnce = process.env.RUNNER_MAINTENANCE_ONCE === 'true';
    if (runOnce) {
        await runMaintenanceCycle();
        return;
    }

    while (!shutdownRequested) {
        await runMaintenanceCycle();
        if (!shutdownRequested) {
            await sleepOrWake(appConfig.runner.leaseReaperIntervalMs);
        }
    }

    logger.info('Runner maintenance worker stopping');
}

function requestShutdown(signal: NodeJS.Signals): void {
    if (shutdownRequested) {
        return;
    }

    shutdownRequested = true;
    logger.info(`Received ${signal}, shutting down runner maintenance worker`);
    wakeLoop?.();
}

process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGINT', () => requestShutdown('SIGINT'));

void main().catch((error) => {
    logger.error('Runner maintenance worker crashed', error);
    process.exitCode = 1;
}).finally(async () => {
    try {
        await prisma.$disconnect();
    } catch (disconnectError) {
        logger.warn('Failed to disconnect Prisma during maintenance shutdown', disconnectError);
    }
});

import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { prisma } from '@/lib/core/prisma';
import { registerSlackSubscriber } from '@/lib/integrations/slack/subscriber';
import { pruneOldRunEvents } from '@/lib/runners/event-retention-service';
import { reapExpiredRunnerLeases, reapStaleLocalBrowserRuns } from '@/lib/runners/lease-reaper';
import { failInvalidQueuedAndroidRuns } from '@/lib/runners/queue-sanitizer';
import { enforceRunArtifactRetention } from '@/lib/runners/run-retention-service';
import { createWakeableSleeper, createWorkerShutdownController } from '@/workers/loop-utils';

const logger = createLogger('worker:runner-maintenance');
const sleeper = createWakeableSleeper();
const shutdown = createWorkerShutdownController({
    logger,
    workerLabel: 'runner maintenance worker',
    wake: sleeper.wake,
});
const MAX_MAINTENANCE_RETRY_INTERVAL_MS = 60_000;

registerSlackSubscriber();

async function runMaintenanceCycle() {
    const [leaseResult, staleLocalBrowserRunResult, retentionResult, queueSanitizerResult] = await Promise.all([
        reapExpiredRunnerLeases(),
        reapStaleLocalBrowserRuns(),
        pruneOldRunEvents(),
        failInvalidQueuedAndroidRuns(),
    ]);
    const runRetentionResult = await enforceRunArtifactRetention();

    if (
        leaseResult.recoveredRuns > 0
        || staleLocalBrowserRunResult.recoveredRuns > 0
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
            staleLocalBrowserRecoveredRuns: staleLocalBrowserRunResult.recoveredRuns,
            staleLocalBrowserRequeuedRuns: staleLocalBrowserRunResult.requeuedRuns,
            staleLocalBrowserFailedRuns: staleLocalBrowserRunResult.failedRuns,
            staleLocalBrowserCutoff: staleLocalBrowserRunResult.staleBefore.toISOString(),
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
        localBrowserStaleTimeoutMs: appConfig.runner.localBrowserStaleTimeoutMs,
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

    let nextIntervalMs = appConfig.runner.leaseReaperIntervalMs;
    while (!shutdown.isShutdownRequested()) {
        try {
            await runMaintenanceCycle();
            nextIntervalMs = appConfig.runner.leaseReaperIntervalMs;
        } catch (error) {
            logger.warn('Runner maintenance cycle failed', {
                error: error instanceof Error ? error.message : String(error),
                retryInMs: nextIntervalMs,
            });
            nextIntervalMs = Math.min(MAX_MAINTENANCE_RETRY_INTERVAL_MS, Math.floor(nextIntervalMs * 2));
        }

        if (!shutdown.isShutdownRequested()) {
            await sleeper.sleepOrWake(nextIntervalMs);
        }
    }

    logger.info('Runner maintenance worker stopping');
}

process.on('SIGTERM', () => shutdown.requestShutdown('SIGTERM'));
process.on('SIGINT', () => shutdown.requestShutdown('SIGINT'));

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

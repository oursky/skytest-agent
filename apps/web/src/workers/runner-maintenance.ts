import { config as appConfig } from '@/config/app';
import { runDatabaseBackupIfDue } from '@/lib/backup/database-backup';
import { createLogger } from '@/lib/core/logger';
import { prisma } from '@/lib/core/prisma';
import { registerSlackSubscriber, registerSlackGroupSubscriber } from '@/lib/integrations/slack/subscriber';
import { registerRunSessionRollupSubscriber } from '@/lib/runtime/run-session-service';
import { pruneOldRunEvents } from '@/lib/runners/event-retention-service';
import { reapExpiredRunnerLeases, reapStaleLocalBrowserRuns, reapStrandedRunSessions } from '@/lib/runners/lease-reaper';
import { failInvalidQueuedAndroidRuns } from '@/lib/runners/queue-sanitizer';
import { enforceRunArtifactRetention } from '@/lib/runners/run-retention-service';
import { runSchedulerTick } from '@/lib/scheduler/scheduler-tick';
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
registerSlackGroupSubscriber();
registerRunSessionRollupSubscriber();

async function runMaintenanceCycle() {
    const [leaseResult, staleLocalBrowserRunResult, strandedSessionResult, retentionResult, queueSanitizerResult] = await Promise.all([
        reapExpiredRunnerLeases(),
        reapStaleLocalBrowserRuns(),
        reapStrandedRunSessions(),
        pruneOldRunEvents(),
        failInvalidQueuedAndroidRuns(),
    ]);
    const runRetentionResult = await enforceRunArtifactRetention();

    if (
        leaseResult.recoveredRuns > 0
        || staleLocalBrowserRunResult.recoveredRuns > 0
        || strandedSessionResult.strandedSessions > 0
        || retentionResult.deletedEvents > 0
        || queueSanitizerResult.failedRuns > 0
        || runRetentionResult.purgedRuns > 0
        || runRetentionResult.purgeFailures > 0
    ) {
        logger.info('Runner maintenance cycle completed', {
            recoveredRuns: leaseResult.recoveredRuns,
            requeuedRuns: leaseResult.requeuedRuns,
            failedRuns: leaseResult.failedRuns,
            staleLocalBrowserRecoveredRuns: staleLocalBrowserRunResult.recoveredRuns,
            staleLocalBrowserRequeuedRuns: staleLocalBrowserRunResult.requeuedRuns,
            staleLocalBrowserFailedRuns: staleLocalBrowserRunResult.failedRuns,
            staleLocalBrowserCutoff: staleLocalBrowserRunResult.staleBefore.toISOString(),
            strandedSessions: strandedSessionResult.strandedSessions,
            strandedSessionMembers: strandedSessionResult.settledMembers,
            deletedEvents: retentionResult.deletedEvents,
            retentionCutoff: retentionResult.cutoff.toISOString(),
            failedInvalidQueuedRuns: queueSanitizerResult.failedRuns,
            purgedRuns: runRetentionResult.purgedRuns,
            purgedArtifacts: runRetentionResult.purgedArtifacts,
            purgeFailures: runRetentionResult.purgeFailures,
            artifactRetentionCutoff: runRetentionResult.retentionCutoff.toISOString(),
        });
    }
}

async function runDatabaseBackupSafely() {
    try {
        const result = await runDatabaseBackupIfDue();
        if (result.performed) {
            logger.info('Database backup completed', {
                key: result.key,
                bytes: result.bytes,
                prunedBackups: result.prunedKeys.length,
            });
        }
    } catch (error) {
        logger.warn('Database backup failed', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function runSchedulerTickSafely() {
    if (!appConfig.scheduler.enabled) {
        return;
    }
    try {
        const result = await runSchedulerTick(appConfig.scheduler.maxDuePerTick);
        if (result.claimedSchedules > 0) {
            logger.info('Scheduler tick completed', result);
        }
    } catch (error) {
        logger.warn('Scheduler tick failed', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function main() {
    logger.info('Runner maintenance worker started', {
        leaseReaperIntervalMs: appConfig.runner.leaseReaperIntervalMs,
        localBrowserStaleTimeoutMs: appConfig.runner.localBrowserStaleTimeoutMs,
        eventRetentionDays: appConfig.runner.eventRetentionDays,
        artifactRetentionDays: appConfig.runner.artifactRetentionDays,
        artifactRetentionBatchSize: appConfig.runner.artifactRetentionBatchSize,
        schedulerEnabled: appConfig.scheduler.enabled,
        schedulerMaxDuePerTick: appConfig.scheduler.maxDuePerTick,
        databaseBackupEnabled: appConfig.databaseBackup.enabled,
        databaseBackupIntervalHours: appConfig.databaseBackup.intervalHours,
    });

    const runOnce = process.env.RUNNER_MAINTENANCE_ONCE === 'true';
    if (runOnce) {
        await runMaintenanceCycle();
        await runSchedulerTickSafely();
        await runDatabaseBackupSafely();
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

        await runSchedulerTickSafely();
        await runDatabaseBackupSafely();

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

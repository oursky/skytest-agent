import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { pruneOldRunEvents } from '@/lib/runners/event-retention-service';
import { reapExpiredRunnerLeases } from '@/lib/runners/lease-reaper';
import { enforceRunArtifactRetention } from '@/lib/runners/run-retention-service';

const logger = createLogger('worker:runner-maintenance');

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function runMaintenanceCycle() {
    const [leaseResult, retentionResult] = await Promise.all([
        reapExpiredRunnerLeases(),
        pruneOldRunEvents(),
    ]);
    const runRetentionResult = await enforceRunArtifactRetention();

    if (
        leaseResult.recoveredRuns > 0
        || retentionResult.deletedEvents > 0
        || runRetentionResult.softDeletedRuns > 0
        || runRetentionResult.hardDeletedRuns > 0
        || runRetentionResult.hardDeleteFailures > 0
    ) {
        logger.info('Runner maintenance cycle completed', {
            recoveredRuns: leaseResult.recoveredRuns,
            deletedEvents: retentionResult.deletedEvents,
            retentionCutoff: retentionResult.cutoff.toISOString(),
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

    while (true) {
        await runMaintenanceCycle();
        await sleep(appConfig.runner.leaseReaperIntervalMs);
    }
}

void main().catch((error) => {
    logger.error('Runner maintenance worker crashed', error);
    process.exitCode = 1;
});

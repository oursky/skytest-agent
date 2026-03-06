import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { pruneOldRunEvents } from '@/lib/runners/event-retention-service';
import { reapExpiredRunnerLeases } from '@/lib/runners/lease-reaper';

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

    if (leaseResult.recoveredRuns > 0 || retentionResult.deletedEvents > 0) {
        logger.info('Runner maintenance cycle completed', {
            recoveredRuns: leaseResult.recoveredRuns,
            deletedEvents: retentionResult.deletedEvents,
            retentionCutoff: retentionResult.cutoff.toISOString(),
        });
    }
}

async function main() {
    logger.info('Runner maintenance worker started', {
        leaseReaperIntervalMs: appConfig.runner.leaseReaperIntervalMs,
        eventRetentionDays: appConfig.runner.eventRetentionDays,
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

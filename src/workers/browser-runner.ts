import os from 'node:os';
import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { cancelLocalBrowserRun, startLocalBrowserRun } from '@/lib/runtime/local-browser-runner';
import { claimNextBrowserRun, renewBrowserRunLease } from '@/lib/runners/browser-claim-service';

const logger = createLogger('worker:browser-runner');

const CLAIM_RETRY_INTERVAL_MS = 1_000;
const LEASE_HEARTBEAT_INTERVAL_MS = Math.max(5_000, Math.floor(appConfig.runner.leaseDurationSeconds * 1000 / 2));
const runnerId = process.env.BROWSER_RUNNER_ID?.trim() || `browser-runner:${os.hostname()}:${process.pid}`;
let stopRequested = false;
let activeRunId: string | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function runLoop() {
    logger.info('Browser runner worker started', {
        runnerId,
        leaseDurationSeconds: appConfig.runner.leaseDurationSeconds,
        leaseHeartbeatIntervalMs: LEASE_HEARTBEAT_INTERVAL_MS,
    });

    while (!stopRequested) {
        const claimed = await claimNextBrowserRun({ runnerId });
        if (stopRequested) {
            break;
        }
        if (!claimed) {
            await sleep(CLAIM_RETRY_INTERVAL_MS);
            continue;
        }
        activeRunId = claimed.runId;

        logger.info('Claimed browser run', {
            runId: claimed.runId,
            leaseExpiresAt: claimed.leaseExpiresAt.toISOString(),
            runnerId,
        });

        const leaseTimer = setInterval(() => {
            void renewBrowserRunLease({ runId: claimed.runId, runnerId })
                .then((leaseExpiry) => {
                    if (!leaseExpiry) {
                        cancelLocalBrowserRun(claimed.runId);
                    }
                })
                .catch((error) => {
                    logger.warn('Failed to renew browser run lease', {
                        runId: claimed.runId,
                        runnerId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
        }, LEASE_HEARTBEAT_INTERVAL_MS);

        try {
            await startLocalBrowserRun(claimed.runId, { runnerId });
        } catch (error) {
            logger.error('Browser run execution failed', {
                runId: claimed.runId,
                runnerId,
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            clearInterval(leaseTimer);
            activeRunId = null;
        }
    }

    logger.info('Browser runner worker stopped', { runnerId });
}

function requestStop(reason: string): void {
    if (stopRequested) {
        return;
    }

    stopRequested = true;
    logger.info('Browser runner worker shutdown requested', {
        runnerId,
        reason,
        activeRunId,
    });

    if (activeRunId) {
        cancelLocalBrowserRun(activeRunId);
    }
}

process.on('SIGTERM', () => requestStop('SIGTERM'));
process.on('SIGINT', () => requestStop('SIGINT'));

void runLoop().catch((error) => {
    logger.error('Browser runner worker crashed', error);
    process.exitCode = 1;
});

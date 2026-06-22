import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { prisma } from '@/lib/core/prisma';
import { registerSlackSubscriber } from '@/lib/integrations/slack/subscriber';
import { dispatchQueuedBrowserRuns } from '@/lib/runtime/browser-run-dispatcher';
import { abortInactiveLocalBrowserRuns } from '@/lib/runtime/local-browser-runner';
import { registerRunSessionRollupSubscriber } from '@/lib/runtime/run-session-service';
import { createWakeableSleeper, createWorkerShutdownController } from '@/workers/loop-utils';

const logger = createLogger('worker:browser-runner');
const sleeper = createWakeableSleeper();
const shutdown = createWorkerShutdownController({
    logger,
    workerLabel: 'browser runner worker',
    wake: sleeper.wake,
});

registerSlackSubscriber();
registerRunSessionRollupSubscriber();

async function main() {
    if (!appConfig.browserWorker.enabled) {
        logger.error('Browser runner worker requires SKYTEST_BROWSER_WORKER=true');
        process.exitCode = 1;
        return;
    }

    logger.info('Browser runner worker started', {
        maxLocalBrowserRuns: appConfig.runner.maxLocalBrowserRuns,
        maxConcurrentRuns: appConfig.runner.maxConcurrentRuns,
        dispatchIntervalMs: appConfig.browserWorker.dispatchIntervalMs,
        maxDispatchIntervalMs: appConfig.browserWorker.maxDispatchIntervalMs,
        maxDispatchesPerCycle: appConfig.browserWorker.maxDispatchesPerCycle,
    });

    let nextDispatchIntervalMs = appConfig.browserWorker.dispatchIntervalMs;
    while (!shutdown.isShutdownRequested()) {
        let abortedRuns = 0;
        let dispatchedRuns = 0;

        try {
            abortedRuns = await abortInactiveLocalBrowserRuns();
            dispatchedRuns = await dispatchQueuedBrowserRuns(appConfig.browserWorker.maxDispatchesPerCycle);

            if (abortedRuns > 0 || dispatchedRuns > 0) {
                nextDispatchIntervalMs = appConfig.browserWorker.dispatchIntervalMs;
                if (abortedRuns > 0) {
                    logger.info('Aborted inactive local browser runs', {
                        abortedRuns,
                    });
                }
            } else {
                nextDispatchIntervalMs = Math.min(
                    appConfig.browserWorker.maxDispatchIntervalMs,
                    Math.floor(nextDispatchIntervalMs * 1.5)
                );
            }
        } catch (error) {
            logger.warn('Browser runner dispatch cycle failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            nextDispatchIntervalMs = Math.min(
                appConfig.browserWorker.maxDispatchIntervalMs,
                Math.floor(nextDispatchIntervalMs * 2)
            );
        }

        if (!shutdown.isShutdownRequested()) {
            await sleeper.sleepOrWake(nextDispatchIntervalMs);
        }
    }

    logger.info('Browser runner worker stopping');
}

process.on('SIGTERM', () => shutdown.requestShutdown('SIGTERM'));
process.on('SIGINT', () => shutdown.requestShutdown('SIGINT'));

void main().catch((error) => {
    logger.error('Browser runner worker crashed', error);
    process.exitCode = 1;
}).finally(async () => {
    try {
        await prisma.$disconnect();
    } catch (disconnectError) {
        logger.warn('Failed to disconnect Prisma during browser runner shutdown', disconnectError);
    }
});

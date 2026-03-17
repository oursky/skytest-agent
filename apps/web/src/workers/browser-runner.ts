import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { prisma } from '@/lib/core/prisma';
import { dispatchQueuedBrowserRuns } from '@/lib/runtime/browser-run-dispatcher';
import { abortInactiveLocalBrowserRuns } from '@/lib/runtime/local-browser-runner';

const logger = createLogger('worker:browser-runner');
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
    while (!shutdownRequested) {
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

        if (!shutdownRequested) {
            await sleepOrWake(nextDispatchIntervalMs);
        }
    }

    logger.info('Browser runner worker stopping');
}

function requestShutdown(signal: NodeJS.Signals): void {
    if (shutdownRequested) {
        return;
    }

    shutdownRequested = true;
    logger.info(`Received ${signal}, shutting down browser runner worker`);
    wakeLoop?.();
}

process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGINT', () => requestShutdown('SIGINT'));

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

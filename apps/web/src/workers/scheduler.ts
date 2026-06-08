import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { prisma } from '@/lib/core/prisma';
import { runSchedulerTick } from '@/lib/scheduler/scheduler-tick';
import { createWakeableSleeper, createWorkerShutdownController } from '@/workers/loop-utils';

const logger = createLogger('worker:scheduler');
const sleeper = createWakeableSleeper();
const shutdown = createWorkerShutdownController({
    logger,
    workerLabel: 'scheduler worker',
    wake: sleeper.wake,
});

async function main() {
    if (!appConfig.scheduler.enabled) {
        logger.error('Scheduler worker requires SKYTEST_SCHEDULER=true');
        process.exitCode = 1;
        return;
    }

    logger.info('Scheduler worker started', {
        evaluationIntervalMs: appConfig.scheduler.evaluationIntervalMs,
        maxDuePerTick: appConfig.scheduler.maxDuePerTick,
    });

    let nextSleepMs = appConfig.scheduler.evaluationIntervalMs;
    while (!shutdown.isShutdownRequested()) {
        try {
            const result = await runSchedulerTick(appConfig.scheduler.maxDuePerTick);
            logger.info('Scheduler tick complete', result);
            nextSleepMs = result.claimedSchedules > 0
                ? appConfig.scheduler.evaluationIntervalMs
                : Math.min(appConfig.scheduler.evaluationIntervalMs * 2, 120_000);
        } catch (error) {
            logger.warn('Scheduler tick failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            nextSleepMs = Math.min(Math.max(nextSleepMs * 2, appConfig.scheduler.evaluationIntervalMs), 120_000);
        }

        if (!shutdown.isShutdownRequested()) {
            await sleeper.sleepOrWake(nextSleepMs);
        }
    }

    logger.info('Scheduler worker stopping');
}

process.on('SIGTERM', () => shutdown.requestShutdown('SIGTERM'));
process.on('SIGINT', () => shutdown.requestShutdown('SIGINT'));

void main().catch((error) => {
    logger.error('Scheduler worker crashed', error);
    process.exitCode = 1;
}).finally(async () => {
    try {
        await prisma.$disconnect();
    } catch (disconnectError) {
        logger.warn('Failed to disconnect Prisma during scheduler shutdown', disconnectError);
    }
});

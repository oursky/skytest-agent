import { config as appConfig } from '@/config/app';
import { prisma } from '@/lib/core/prisma';

function getRetentionCutoff(now: Date): Date {
    return new Date(now.getTime() - appConfig.runner.eventRetentionDays * 24 * 60 * 60 * 1000);
}

export async function pruneOldRunEvents(now = new Date()) {
    const cutoff = getRetentionCutoff(now);
    const result = await prisma.testRunEvent.deleteMany({
        where: {
            createdAt: { lt: cutoff },
        },
    });

    return {
        deletedEvents: result.count,
        cutoff,
    };
}

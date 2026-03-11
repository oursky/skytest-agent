import { config as appConfig } from '@/config/app';
import { prisma } from '@/lib/core/prisma';

const EVENT_RETENTION_DELETE_BATCH_SIZE = 10_000;

function getRetentionCutoff(now: Date): Date {
    return new Date(now.getTime() - appConfig.runner.eventRetentionDays * 24 * 60 * 60 * 1000);
}

export async function pruneOldRunEvents(now = new Date()) {
    const cutoff = getRetentionCutoff(now);
    let deletedEvents = 0;

    while (true) {
        const eventsToDelete = await prisma.testRunEvent.findMany({
            where: {
                createdAt: { lt: cutoff },
            },
            orderBy: {
                createdAt: 'asc',
            },
            take: EVENT_RETENTION_DELETE_BATCH_SIZE,
            select: {
                id: true,
            },
        });

        if (eventsToDelete.length === 0) {
            break;
        }

        const deleteResult = await prisma.testRunEvent.deleteMany({
            where: {
                id: {
                    in: eventsToDelete.map((event) => event.id),
                },
            },
        });
        deletedEvents += deleteResult.count;

        if (eventsToDelete.length < EVENT_RETENTION_DELETE_BATCH_SIZE) {
            break;
        }
    }

    return {
        deletedEvents,
        cutoff,
    };
}

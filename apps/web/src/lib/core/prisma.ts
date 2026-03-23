import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

const enableQueryLogging = process.env.PRISMA_LOG_QUERIES === 'true';
let runtimePrismaClient: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required');
    }

    return new PrismaClient({
        log: enableQueryLogging ? ['query'] : [],
    });
}

function getPrismaClient(): PrismaClient {
    if (globalForPrisma.prisma) {
        return globalForPrisma.prisma;
    }

    if (!runtimePrismaClient) {
        runtimePrismaClient = createPrismaClient();
    }

    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = runtimePrismaClient;
    }

    return runtimePrismaClient;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
    get(_target, prop, receiver) {
        const client = getPrismaClient() as unknown as Record<PropertyKey, unknown>;
        const value = Reflect.get(client, prop, receiver);
        if (typeof value === 'function') {
            return (value as (...args: unknown[]) => unknown).bind(client);
        }
        return value;
    },
});

export async function checkDatabaseHealth(): Promise<void> {
    await prisma.$queryRawUnsafe('SELECT 1');
}

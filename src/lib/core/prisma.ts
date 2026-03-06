import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

const enableQueryLogging = process.env.PRISMA_LOG_QUERIES === 'true';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
}

const createPrismaClient = () =>
    new PrismaClient({
        log: enableQueryLogging ? ['query'] : [],
        adapter: new PrismaPg({ connectionString: databaseUrl }),
    });

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

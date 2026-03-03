import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';


const globalForPrisma = global as unknown as { prisma: PrismaClient };

const enableQueryLogging = process.env.PRISMA_LOG_QUERIES === 'true';

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        log: enableQueryLogging ? ['query'] : [],
        adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./dev.db" }),
    });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

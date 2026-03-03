import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('usage');

export class UsageService {
    static async recordUsage(
        userId: string,
        aiActions: number,
        description?: string,
        testRunId?: string
    ) {
        if (aiActions <= 0) return;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            logger.warn('Usage record skipped: user not found', { userId });
            return;
        }

        return await prisma.usageRecord.create({
            data: {
                userId: user.id,
                type: 'TEST_RUN',
                description,
                aiActions,
                testRunId
            }
        });
    }
}

import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';

const logger = createLogger('usage');

export class UsageService {
    static async recordUsage(
        actorUserId: string,
        projectId: string,
        aiActions: number,
        description?: string,
        testRunId?: string
    ) {
        if (aiActions <= 0) return;

        const [user, project] = await Promise.all([
            prisma.user.findUnique({ where: { id: actorUserId }, select: { id: true } }),
            prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
        ]);

        if (!user || !project) {
            logger.warn('Usage record skipped: actor or project not found', {
                actorUserId,
                projectId,
            });
            return;
        }

        return await prisma.usageRecord.create({
            data: {
                actorUserId: user.id,
                projectId: project.id,
                type: 'TEST_RUN',
                description,
                aiActions,
                testRunId
            }
        });
    }
}

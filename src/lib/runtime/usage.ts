import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';

const logger = createLogger('usage');

interface ParsedRunResult {
    actionCount?: unknown;
}

interface RecordRunUsageFromResultInput {
    actorUserId: string;
    projectId: string;
    result?: string;
    description?: string;
    testRunId: string;
}

export function parseActionCountFromResult(result?: string): number {
    if (!result) {
        return 0;
    }

    try {
        const parsed = JSON.parse(result) as ParsedRunResult;
        if (typeof parsed.actionCount !== 'number' || !Number.isFinite(parsed.actionCount)) {
            return 0;
        }
        return Math.max(0, Math.floor(parsed.actionCount));
    } catch {
        return 0;
    }
}

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

        if (testRunId) {
            return await prisma.usageRecord.upsert({
                where: { testRunId },
                update: {
                    actorUserId: user.id,
                    projectId: project.id,
                    type: 'TEST_RUN',
                    description,
                    aiActions,
                },
                create: {
                    actorUserId: user.id,
                    projectId: project.id,
                    type: 'TEST_RUN',
                    description,
                    aiActions,
                    testRunId
                }
            });
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

    static async recordRunUsageFromResult(input: RecordRunUsageFromResultInput) {
        const actionCount = parseActionCountFromResult(input.result);
        if (actionCount <= 0) {
            return;
        }

        return await UsageService.recordUsage(
            input.actorUserId,
            input.projectId,
            actionCount,
            input.description,
            input.testRunId
        );
    }
}

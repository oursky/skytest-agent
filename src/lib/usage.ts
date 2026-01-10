import { prisma } from './prisma';

export class UsageService {
    static async ensureUser(userId: string, email?: string | null): Promise<void> {
        await prisma.user.upsert({
            where: { authId: userId },
            update: {},
            create: {
                id: userId,
                authId: userId,
                email: email || null
            }
        });
    }

    static async recordUsage(
        userId: string,
        aiActions: number,
        description?: string,
        testRunId?: string
    ) {
        if (aiActions <= 0) return;

        await this.ensureUser(userId);

        const user = await prisma.user.findUnique({ where: { authId: userId } });
        if (!user) throw new Error("User not found");

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

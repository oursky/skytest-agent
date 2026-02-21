import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { emulatorPool } from '@/lib/emulator-pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:emulators');

export const dynamic = 'force-dynamic';

async function isAndroidEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { androidEnabled: true },
    });
    return user?.androidEnabled ?? false;
}

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId || !(await isAndroidEnabled(userId))) {
        return NextResponse.json({ error: 'Android testing is not enabled for your account' }, { status: 403 });
    }

    try {
        const projects = await prisma.project.findMany({
            where: { userId },
            select: { id: true },
        });
        const projectIds = new Set(projects.map(project => project.id));
        const status = emulatorPool.getStatus(projectIds);

        const acquiredRunIds = status.emulators
            .filter(e => e.state === 'ACQUIRED' && e.runId)
            .map(e => e.runId as string);

        if (acquiredRunIds.length > 0) {
            const runs = await prisma.testRun.findMany({
                where: { id: { in: acquiredRunIds } },
                select: {
                    id: true,
                    testCase: { select: { id: true, name: true, displayId: true } },
                },
            });
            const runMap = new Map(runs.map(r => [r.id, r]));

            for (const emulator of status.emulators) {
                if (emulator.runId) {
                    const run = runMap.get(emulator.runId);
                    if (run) {
                        emulator.runTestCaseId = run.testCase.id;
                        emulator.runTestCaseName = run.testCase.name;
                        emulator.runTestCaseDisplayId = run.testCase.displayId ?? undefined;
                    }
                }
            }
        }

        return NextResponse.json(status);
    } catch (error) {
        logger.error('Failed to get emulator pool status', error);
        return NextResponse.json({ error: 'Failed to get pool status' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId || !(await isAndroidEnabled(userId))) {
        return NextResponse.json({ error: 'Android testing is not enabled for your account' }, { status: 403 });
    }

    try {
        const body = await request.json() as { action: string; emulatorId?: string };
        const { action, emulatorId } = body;

        if (action === 'stop' && emulatorId) {
            await emulatorPool.stop(emulatorId);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        logger.error('Failed to execute emulator action', error);
        return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
    }
}

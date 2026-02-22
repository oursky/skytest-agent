import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { emulatorPool } from '@/lib/emulator-pool';
import { listAvailableAndroidProfiles } from '@/lib/android-profiles';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:emulators');

export const dynamic = 'force-dynamic';

async function ensureProjectOwnership(projectId: string, userId: string): Promise<boolean> {
    const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
    });
    return Boolean(project);
}

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
        const { searchParams } = new URL(request.url);
        const requestedProjectId = searchParams.get('projectId')?.trim();

        let projectIds: Set<string>;
        if (requestedProjectId) {
            const owned = await ensureProjectOwnership(requestedProjectId, userId);
            if (!owned) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            projectIds = new Set([requestedProjectId]);
        } else {
            const projects = await prisma.project.findMany({
                where: { userId },
                select: { id: true },
            });
            projectIds = new Set(projects.map(project => project.id));
        }

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

        const avdProfiles = await listAvailableAndroidProfiles();

        return NextResponse.json({
            ...status,
            avdProfiles,
        });
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
        const body = await request.json() as {
            action: string;
            emulatorId?: string;
            projectId?: string;
            avdName?: string;
            mode?: 'window' | 'headless';
        };
        const { action } = body;

        if (action === 'stop' && body.emulatorId) {
            const emulatorId = body.emulatorId;
            const ownedEmulator = emulatorPool
                .getStatus(new Set(
                    (await prisma.project.findMany({
                        where: { userId },
                        select: { id: true },
                    })).map((project) => project.id)
                ))
                .emulators
                .find((emulator) => emulator.id === emulatorId);

            if (ownedEmulator) {
                await emulatorPool.stop(emulatorId);
                return NextResponse.json({ success: true });
            }
            return NextResponse.json({ error: 'Emulator not found' }, { status: 404 });
        }

        if (action === 'boot' && body.projectId && body.avdName) {
            const projectId = body.projectId.trim();
            const avdName = body.avdName.trim();
            const mode = body.mode === 'window' ? 'window' : 'headless';

            if (!projectId || !avdName) {
                return NextResponse.json({ error: 'projectId and avdName are required' }, { status: 400 });
            }

            const owned = await ensureProjectOwnership(projectId, userId);
            if (!owned) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }

            const availableProfiles = await listAvailableAndroidProfiles();
            if (!availableProfiles.some((profile) => profile.name === avdName)) {
                return NextResponse.json({ error: `Unknown AVD profile "${avdName}"` }, { status: 400 });
            }

            const existing = emulatorPool.getStatus(new Set([projectId])).emulators.find(
                (emulator) => emulator.avdName === avdName && emulator.state !== 'DEAD'
            );
            if (existing) {
                return NextResponse.json(
                    { error: `Emulator for "${avdName}" is already running` },
                    { status: 409 }
                );
            }

            const handle = await emulatorPool.boot(projectId, avdName, { headless: mode === 'headless' });
            return NextResponse.json({ success: true, emulatorId: handle.id, state: handle.state });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        logger.error('Failed to execute emulator action', error);
        return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
    }
}

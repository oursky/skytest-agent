import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { emulatorPool } from '@/lib/emulator-pool';
import { listAvailableAndroidProfiles } from '@/lib/android-profiles';
import { createLogger } from '@/lib/logger';
import { getAndroidAccessStatusForUser, type AndroidAccessStatus } from '@/lib/user-features';

const logger = createLogger('api:emulators');

export const dynamic = 'force-dynamic';

function getAndroidAccessError(status: Exclude<AndroidAccessStatus, 'enabled'>) {
    if (status === 'runtime-unavailable') {
        return { error: 'Android testing is not available on this server', status: 503 as const };
    }
    return { error: 'Android testing is not enabled for your account', status: 403 as const };
}

async function ensureProjectOwnership(projectId: string, userId: string): Promise<boolean> {
    const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
    });
    return Boolean(project);
}

async function listOwnedProjectIds(userId: string): Promise<Set<string>> {
    const projects = await prisma.project.findMany({
        where: { userId },
        select: { id: true },
    });
    return new Set(projects.map((project) => project.id));
}

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const androidAccessStatus = await getAndroidAccessStatusForUser(userId);
    if (androidAccessStatus !== 'enabled') {
        const error = getAndroidAccessError(androidAccessStatus);
        return NextResponse.json({ error: error.error }, { status: error.status });
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
            projectIds = await listOwnedProjectIds(userId);
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
                    testCase: { select: { id: true, name: true, displayId: true, projectId: true } },
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
                        emulator.runProjectId = run.testCase.projectId;
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
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const androidAccessStatus = await getAndroidAccessStatusForUser(userId);
    if (androidAccessStatus !== 'enabled') {
        const error = getAndroidAccessError(androidAccessStatus);
        return NextResponse.json({ error: error.error }, { status: error.status });
    }

    try {
        const body = await request.json() as {
            action: string;
            emulatorId?: string;
            avdName?: string;
        };
        const { action } = body;

        if (action === 'stop' && body.emulatorId) {
            const emulatorId = body.emulatorId;
            const emulator = emulatorPool.getStatus().emulators.find((item) => item.id === emulatorId);
            if (!emulator) {
                return NextResponse.json({ error: 'Emulator not found' }, { status: 404 });
            }

            if (emulator.state === 'ACQUIRED' && emulator.runId) {
                const testRun = await prisma.testRun.findUnique({
                    where: { id: emulator.runId },
                    select: {
                        testCase: {
                            select: {
                                project: { select: { userId: true } }
                            }
                        }
                    }
                });

                if (!testRun || testRun.testCase.project.userId !== userId) {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                }
            }

            await emulatorPool.stop(emulatorId);
            return NextResponse.json({ success: true });
        }

        if (action === 'boot' && body.avdName) {
            const avdName = body.avdName.trim();

            if (!avdName) {
                return NextResponse.json({ error: 'avdName is required' }, { status: 400 });
            }

            const availableProfiles = await listAvailableAndroidProfiles();
            if (!availableProfiles.some((profile) => profile.name === avdName)) {
                return NextResponse.json({ error: `Unknown AVD profile "${avdName}"` }, { status: 400 });
            }

            const existing = emulatorPool.getStatus().emulators.find(
                (emulator) => emulator.avdName === avdName && emulator.state !== 'DEAD'
            );
            if (existing) {
                return NextResponse.json(
                    { error: `Emulator for "${avdName}" is already running` },
                    { status: 409 }
                );
            }

            const handle = await emulatorPool.boot(null, avdName, { headless: false });
            return NextResponse.json({ success: true, emulatorId: handle.id, state: handle.state });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        logger.error('Failed to execute emulator action', error);
        return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
    }
}

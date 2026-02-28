import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { androidDeviceManager } from '@/lib/android-device-manager';
import { listAndroidDeviceInventory } from '@/lib/android-devices';
import { createLogger } from '@/lib/logger';
import { getAndroidAccessStatus } from '@/lib/user-features';

const logger = createLogger('api:devices');

export const dynamic = 'force-dynamic';

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

    if (getAndroidAccessStatus() !== 'enabled') {
        return NextResponse.json({ error: 'Android testing is not available on this server' }, { status: 503 });
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

        const [status, inventory] = await Promise.all([
            Promise.resolve(androidDeviceManager.getStatus(projectIds)),
            listAndroidDeviceInventory(),
        ]);

        const acquiredRunIds = status.devices
            .filter((device) => device.state === 'ACQUIRED' && device.runId)
            .map((device) => device.runId as string);

        if (acquiredRunIds.length > 0) {
            const runs = await prisma.testRun.findMany({
                where: { id: { in: acquiredRunIds } },
                select: {
                    id: true,
                    testCase: { select: { id: true, name: true, displayId: true, projectId: true } },
                },
            });
            const runMap = new Map(runs.map((run) => [run.id, run]));

            for (const device of status.devices) {
                if (!device.runId) {
                    continue;
                }
                const run = runMap.get(device.runId);
                if (!run) {
                    continue;
                }
                device.runTestCaseId = run.testCase.id;
                device.runTestCaseName = run.testCase.name;
                device.runTestCaseDisplayId = run.testCase.displayId ?? undefined;
                device.runProjectId = run.testCase.projectId;
            }
        }

        return NextResponse.json({
            ...status,
            connectedDevices: inventory.connectedDevices,
            emulatorProfiles: inventory.emulatorProfiles,
        });
    } catch (error) {
        logger.error('Failed to get Android device status', error);
        return NextResponse.json({ error: 'Failed to get device status' }, { status: 500 });
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

    if (getAndroidAccessStatus() !== 'enabled') {
        return NextResponse.json({ error: 'Android testing is not available on this server' }, { status: 503 });
    }

    try {
        const body = await request.json() as {
            action: string;
            deviceId?: string;
            serial?: string;
            emulatorProfileName?: string;
        };

        if (body.action === 'stop' && (body.deviceId || body.serial)) {
            const stopDeviceId = body.deviceId?.trim();
            const stopSerial = body.serial?.trim();
            const status = androidDeviceManager.getStatus();
            const managedDevice = stopDeviceId
                ? status.devices.find((item) => item.id === stopDeviceId)
                : (stopSerial ? status.devices.find((item) => item.serial === stopSerial) : undefined);

            if (managedDevice) {
                if (managedDevice.kind === 'physical') {
                    return NextResponse.json({ error: 'Stopping connected physical devices is not supported' }, { status: 400 });
                }

                if (managedDevice.state === 'ACQUIRED' && managedDevice.runId) {
                    const testRun = await prisma.testRun.findUnique({
                        where: { id: managedDevice.runId },
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

                await androidDeviceManager.stop(managedDevice.id);
                return NextResponse.json({ success: true });
            }

            if (!stopSerial) {
                return NextResponse.json({ error: 'Device not found' }, { status: 404 });
            }

            const { connectedDevices } = await listAndroidDeviceInventory();
            const connected = connectedDevices.find((item) => item.serial === stopSerial);
            if (!connected || connected.kind !== 'emulator') {
                return NextResponse.json({ error: 'Device not found' }, { status: 404 });
            }
            if (connected.adbState !== 'device') {
                return NextResponse.json({ error: `Emulator is not ready (state: ${connected.adbState})` }, { status: 409 });
            }

            await androidDeviceManager.stopConnectedEmulator(stopSerial);
            return NextResponse.json({ success: true });
        }

        if (body.action === 'boot' && body.emulatorProfileName) {
            const emulatorProfileName = body.emulatorProfileName.trim();
            if (!emulatorProfileName) {
                return NextResponse.json({ error: 'emulatorProfileName is required' }, { status: 400 });
            }

            const { emulatorProfiles } = await listAndroidDeviceInventory();
            if (!emulatorProfiles.some((profile) => profile.name === emulatorProfileName)) {
                return NextResponse.json({ error: `Unknown emulator profile "${emulatorProfileName}"` }, { status: 400 });
            }

            const existing = androidDeviceManager.getStatus().devices.find(
                (device) =>
                    device.kind === 'emulator'
                    && device.emulatorProfileName === emulatorProfileName
                    && device.state !== 'DEAD'
            );
            if (existing) {
                return NextResponse.json(
                    { error: `Device for "${emulatorProfileName}" is already running` },
                    { status: 409 }
                );
            }

            const handle = await androidDeviceManager.boot(null, emulatorProfileName, { headless: false });
            return NextResponse.json({ success: true, deviceId: handle.id, state: handle.state });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        logger.error('Failed to execute Android device action', error);
        return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
    }
}

import type { DeviceSyncItem } from '@skytest/runner-protocol';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';

const MAX_SYNC_DEVICES = 100;

export async function syncRunnerDevices(input: {
    runnerId: string;
    devices: DeviceSyncItem[];
}) {
    if (input.devices.length > MAX_SYNC_DEVICES) {
        throw new Error('Too many devices in snapshot');
    }

    const syncedAt = new Date();
    const uniqueDevices = new Map<string, DeviceSyncItem>();
    for (const device of input.devices) {
        uniqueDevices.set(device.deviceId, device);
    }

    const deviceIds = [...uniqueDevices.keys()];

    await prisma.$transaction(async (tx) => {
        for (const device of uniqueDevices.values()) {
            await tx.runnerDevice.upsert({
                where: {
                    runnerId_deviceId: {
                        runnerId: input.runnerId,
                        deviceId: device.deviceId,
                    },
                },
                update: {
                    platform: device.platform,
                    name: device.name,
                    state: device.state,
                    metadata: device.metadata as Prisma.InputJsonValue | undefined,
                    lastSeenAt: syncedAt,
                },
                create: {
                    runnerId: input.runnerId,
                    deviceId: device.deviceId,
                    platform: device.platform,
                    name: device.name,
                    state: device.state,
                    metadata: device.metadata as Prisma.InputJsonValue | undefined,
                    lastSeenAt: syncedAt,
                },
            });
        }

        if (deviceIds.length === 0) {
            await tx.runnerDevice.updateMany({
                where: { runnerId: input.runnerId },
                data: { state: 'OFFLINE' },
            });
            return;
        }

        await tx.runnerDevice.updateMany({
            where: {
                runnerId: input.runnerId,
                deviceId: { notIn: deviceIds },
            },
            data: { state: 'OFFLINE' },
        });
    });

    return {
        syncedAt,
        deviceCount: uniqueDevices.size,
    };
}

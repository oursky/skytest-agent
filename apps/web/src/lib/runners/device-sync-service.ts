import type { DeviceSyncItem } from '@skytest/runner-protocol';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';

const MAX_SYNC_DEVICES = 100;
const LAST_SEEN_REFRESH_INTERVAL_MS = 30_000;

function normalizeMetadataValue(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) {
        return undefined;
    }
    return value as Prisma.InputJsonValue;
}

function isMetadataEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

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
        const existingDevices = await tx.runnerDevice.findMany({
            where: {
                runnerId: input.runnerId,
                deviceId: {
                    in: deviceIds,
                },
            },
            select: {
                runnerId: true,
                deviceId: true,
                platform: true,
                name: true,
                state: true,
                metadata: true,
                lastSeenAt: true,
            },
        });
        const existingByDeviceId = new Map(existingDevices.map((device) => [device.deviceId, device]));

        const devicesToCreate: Prisma.RunnerDeviceCreateManyInput[] = [];
        const devicesToUpdate: Array<{
            where: {
                runnerId_deviceId: {
                    runnerId: string;
                    deviceId: string;
                };
            };
            data: Prisma.RunnerDeviceUpdateManyMutationInput;
        }> = [];

        for (const device of uniqueDevices.values()) {
            const existing = existingByDeviceId.get(device.deviceId);
            const metadata = normalizeMetadataValue(device.metadata);
            if (!existing) {
                devicesToCreate.push({
                    runnerId: input.runnerId,
                    deviceId: device.deviceId,
                    platform: device.platform,
                    name: device.name,
                    state: device.state,
                    metadata,
                    lastSeenAt: syncedAt,
                });
                continue;
            }

            const shouldRefreshLastSeen = syncedAt.getTime() - existing.lastSeenAt.getTime() >= LAST_SEEN_REFRESH_INTERVAL_MS;
            const changed = (
                existing.platform !== device.platform
                || existing.name !== device.name
                || existing.state !== device.state
                || !isMetadataEqual(existing.metadata, device.metadata)
            );

            if (!changed && !shouldRefreshLastSeen) {
                continue;
            }

            devicesToUpdate.push({
                where: {
                    runnerId_deviceId: {
                        runnerId: input.runnerId,
                        deviceId: device.deviceId,
                    },
                },
                data: {
                    platform: device.platform,
                    name: device.name,
                    state: device.state,
                    metadata,
                    lastSeenAt: syncedAt,
                },
            });
        }

        if (devicesToCreate.length > 0) {
            await tx.runnerDevice.createMany({
                data: devicesToCreate,
                skipDuplicates: true,
            });
        }
        for (const update of devicesToUpdate) {
            await tx.runnerDevice.update({
                where: update.where,
                data: update.data,
            });
        }

        if (deviceIds.length === 0) {
            await tx.runnerDevice.updateMany({
                where: {
                    runnerId: input.runnerId,
                    state: { not: 'OFFLINE' },
                },
                data: { state: 'OFFLINE' },
            });
            return;
        }

        await tx.runnerDevice.updateMany({
            where: {
                runnerId: input.runnerId,
                deviceId: { notIn: deviceIds },
                state: { not: 'OFFLINE' },
            },
            data: { state: 'OFFLINE' },
        });
    });

    return {
        syncedAt,
        deviceCount: uniqueDevices.size,
    };
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    findMany,
    createMany,
    update,
    updateMany,
    transaction,
} = vi.hoisted(() => ({
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        $transaction: transaction,
    },
}));

const { syncRunnerDevices } = await import('@/lib/runners/device-sync-service');

describe('syncRunnerDevices', () => {
    beforeEach(() => {
        findMany.mockReset();
        createMany.mockReset();
        update.mockReset();
        updateMany.mockReset();
        transaction.mockReset();

        transaction.mockImplementation(async (callback: (tx: {
            runnerDevice: {
                findMany: typeof findMany;
                createMany: typeof createMany;
                update: typeof update;
                updateMany: typeof updateMany;
            };
        }) => Promise<unknown>) => callback({
            runnerDevice: {
                findMany,
                createMany,
                update,
                updateMany,
            },
        }));
    });

    it('upserts incoming devices and marks stale rows offline', async () => {
        findMany.mockResolvedValueOnce([]);

        await syncRunnerDevices({
            runnerId: 'runner-1',
            devices: [
                {
                    deviceId: 'device-1',
                    platform: 'ANDROID',
                    name: 'Pixel 9',
                    state: 'ONLINE',
                    metadata: { serial: 'ABC123' },
                },
                {
                    deviceId: 'device-2',
                    platform: 'ANDROID',
                    name: 'Pixel 8',
                    state: 'UNAVAILABLE',
                },
            ],
        });

        expect(findMany).toHaveBeenCalledWith({
            where: {
                runnerId: 'runner-1',
                deviceId: {
                    in: ['device-1', 'device-2'],
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
        expect(createMany).toHaveBeenCalledTimes(1);
        expect(createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({
                    runnerId: 'runner-1',
                    deviceId: 'device-1',
                    platform: 'ANDROID',
                    name: 'Pixel 9',
                    state: 'ONLINE',
                    metadata: { serial: 'ABC123' },
                }),
                expect.objectContaining({
                    runnerId: 'runner-1',
                    deviceId: 'device-2',
                    platform: 'ANDROID',
                    name: 'Pixel 8',
                    state: 'UNAVAILABLE',
                }),
            ],
            skipDuplicates: true,
        });
        expect(update).not.toHaveBeenCalled();
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                runnerId: 'runner-1',
                deviceId: { notIn: ['device-1', 'device-2'] },
                state: { not: 'OFFLINE' },
            },
            data: { state: 'OFFLINE' },
        });
    });

    it('marks all devices offline when an empty snapshot is sent', async () => {
        findMany.mockResolvedValueOnce([]);

        await syncRunnerDevices({
            runnerId: 'runner-1',
            devices: [],
        });

        expect(createMany).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                runnerId: 'runner-1',
                state: { not: 'OFFLINE' },
            },
            data: { state: 'OFFLINE' },
        });
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    upsert,
    updateMany,
    transaction,
} = vi.hoisted(() => ({
    upsert: vi.fn(),
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
        upsert.mockReset();
        updateMany.mockReset();
        transaction.mockReset();

        transaction.mockImplementation(async (callback: (tx: {
            runnerDevice: {
                upsert: typeof upsert;
                updateMany: typeof updateMany;
            };
        }) => Promise<unknown>) => callback({
            runnerDevice: {
                upsert,
                updateMany,
            },
        }));
    });

    it('upserts incoming devices and marks stale rows offline', async () => {
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

        expect(upsert).toHaveBeenCalledTimes(2);
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                runnerId: 'runner-1',
                deviceId: { notIn: ['device-1', 'device-2'] },
            },
            data: { state: 'OFFLINE' },
        });
    });

    it('marks all devices offline when an empty snapshot is sent', async () => {
        await syncRunnerDevices({
            runnerId: 'runner-1',
            devices: [],
        });

        expect(upsert).not.toHaveBeenCalled();
        expect(updateMany).toHaveBeenCalledWith({
            where: { runnerId: 'runner-1' },
            data: { state: 'OFFLINE' },
        });
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw, executeRaw, updateManyRun, deleteManyLock, transaction } = vi.hoisted(() => ({
    queryRaw: vi.fn(),
    executeRaw: vi.fn(),
    updateManyRun: vi.fn(),
    deleteManyLock: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        $transaction: transaction,
    },
}));

const { claimNextRunForRunner } = await import('@/lib/runners/claim-service');

describe('claimNextRunForRunner', () => {
    beforeEach(() => {
        queryRaw.mockReset();
        executeRaw.mockReset();
        updateManyRun.mockReset();
        deleteManyLock.mockReset();
        transaction.mockReset();
        transaction.mockImplementation(async (callback: (tx: {
            $queryRaw: typeof queryRaw;
            $executeRaw: typeof executeRaw;
            testRun: {
                updateMany: typeof updateManyRun;
            };
            androidResourceLock: {
                deleteMany: typeof deleteManyLock;
            };
        }) => Promise<unknown>) => {
            return callback({
                $queryRaw: queryRaw,
                $executeRaw: executeRaw,
                testRun: {
                    updateMany: updateManyRun,
                },
                androidResourceLock: {
                    deleteMany: deleteManyLock,
                },
            });
        });
        updateManyRun.mockResolvedValue({ count: 1 });
        deleteManyLock.mockResolvedValue({ count: 0 });
    });

    it('claims explicit-device jobs before generic jobs', async () => {
        queryRaw
            .mockResolvedValueOnce([{
                id: 'run-1',
                testCaseId: 'test-case-1',
                requiredCapability: 'ANDROID',
                requestedDeviceId: 'device-a',
                requestedRunnerId: null,
                hostFingerprint: 'host-fp-a',
                resourceKey: 'connected-device:device-a',
                resourceType: 'CONNECTED_DEVICE',
            }]);
        executeRaw
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(1);

        const result = await claimNextRunForRunner({
            runnerId: 'runner-1',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(result).toEqual({
            runId: 'run-1',
            testCaseId: 'test-case-1',
            requiredCapability: 'ANDROID',
            requestedDeviceId: 'device-a',
            requestedRunnerId: null,
            leaseExpiresAt: expect.any(Date),
        });
        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(executeRaw).toHaveBeenCalledTimes(2);
        expect(updateManyRun).toHaveBeenCalledWith({
            where: {
                id: 'run-1',
                status: 'QUEUED',
                deletedAt: null,
                assignedRunnerId: null,
                requestedDeviceId: 'device-a',
            },
            data: {
                assignedRunnerId: 'runner-1',
                leaseExpiresAt: expect.any(Date),
                status: 'PREPARING',
                startedAt: expect.any(Date),
            },
        });
        const [firstQuery] = queryRaw.mock.calls[0];
        expect(firstQuery.strings.join('')).toContain('"RunnerDevice"');
        expect(firstQuery.strings.join('')).toContain('"Runner" r');
        expect(firstQuery.strings.join('')).toContain('"AndroidResourceLock"');
        expect(firstQuery.strings.join('')).toContain('"requestedRunnerId"');
        expect(firstQuery.strings.join('')).toContain(`'OFFLINE'`);
        expect(firstQuery.strings.join('')).toContain('NOT EXISTS');
        expect(firstQuery.values).toContain('connected-device:');
    });

    it('falls back to generic Android jobs when no explicit-device job is claimable', async () => {
        const leaseExpiresAt = new Date('2026-03-07T03:00:00.000Z');
        queryRaw
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{
                id: 'run-2',
                testCaseId: 'test-case-2',
                requiredCapability: 'ANDROID',
                requestedDeviceId: null,
                requestedRunnerId: null,
                leaseExpiresAt,
            }]);

        const result = await claimNextRunForRunner({
            runnerId: 'runner-2',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(result).toEqual({
            runId: 'run-2',
            testCaseId: 'test-case-2',
            requiredCapability: 'ANDROID',
            requestedDeviceId: null,
            requestedRunnerId: null,
            leaseExpiresAt,
        });
        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(executeRaw).not.toHaveBeenCalled();
        expect(updateManyRun).not.toHaveBeenCalled();
    });

    it('falls back to generic jobs when explicit-device resource lock is not acquired', async () => {
        const leaseExpiresAt = new Date('2026-03-07T04:00:00.000Z');
        queryRaw
            .mockResolvedValueOnce([{
                id: 'run-1',
                testCaseId: 'test-case-1',
                requiredCapability: 'ANDROID',
                requestedDeviceId: 'device-a',
                requestedRunnerId: null,
                hostFingerprint: 'host-fp-a',
                resourceKey: 'connected-device:device-a',
                resourceType: 'CONNECTED_DEVICE',
            }])
            .mockResolvedValueOnce([{
                id: 'run-2',
                testCaseId: 'test-case-2',
                requiredCapability: 'ANDROID',
                requestedDeviceId: null,
                requestedRunnerId: null,
                leaseExpiresAt,
            }]);
        executeRaw
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(0);

        const result = await claimNextRunForRunner({
            runnerId: 'runner-2',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(result).toEqual({
            runId: 'run-2',
            testCaseId: 'test-case-2',
            requiredCapability: 'ANDROID',
            requestedDeviceId: null,
            requestedRunnerId: null,
            leaseExpiresAt,
        });
        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(executeRaw).toHaveBeenCalledTimes(2);
        expect(updateManyRun).not.toHaveBeenCalled();
    });

    it('does not claim when runner lacks Android capability', async () => {
        const result = await claimNextRunForRunner({
            runnerId: 'runner-3',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: [],
        });

        expect(result).toBeNull();
        expect(queryRaw).not.toHaveBeenCalled();
    });
});

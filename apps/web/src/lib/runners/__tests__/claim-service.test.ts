import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    queryRaw,
    executeRaw,
    updateManyRun,
    deleteManyLock,
    transaction,
    runnerDeviceFindMany,
    testRunCount,
    runnerFindUnique,
} = vi.hoisted(() => ({
    queryRaw: vi.fn(),
    executeRaw: vi.fn(),
    updateManyRun: vi.fn(),
    deleteManyLock: vi.fn(),
    transaction: vi.fn(),
    runnerDeviceFindMany: vi.fn(),
    testRunCount: vi.fn(),
    runnerFindUnique: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        $transaction: transaction,
        $queryRaw: queryRaw,
        runnerDevice: {
            findMany: runnerDeviceFindMany,
        },
        testRun: {
            count: testRunCount,
        },
        runner: {
            findUnique: runnerFindUnique,
        },
    },
}));

const { claimNextRunForRunner, diagnoseNoClaimForRunner } = await import('@/lib/runners/claim-service');

describe('claimNextRunForRunner', () => {
    beforeEach(() => {
        queryRaw.mockReset();
        executeRaw.mockReset();
        updateManyRun.mockReset();
        deleteManyLock.mockReset();
        transaction.mockReset();
        runnerDeviceFindMany.mockReset();
        testRunCount.mockReset();
        runnerFindUnique.mockReset();
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
        runnerDeviceFindMany.mockResolvedValue([]);
        testRunCount.mockResolvedValue(0);
        runnerFindUnique.mockResolvedValue({ hostFingerprint: 'host-fp-a' });
    });

    it('claims explicit connected-device jobs and acquires host resource lock', async () => {
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

    it('claims explicit emulator-profile jobs with emulator resource key semantics', async () => {
        queryRaw.mockResolvedValueOnce([{
            id: 'run-emu',
            testCaseId: 'test-case-emu',
            requiredCapability: 'ANDROID',
            requestedDeviceId: 'emulator-profile:Pixel_8',
            requestedRunnerId: 'runner-2',
            hostFingerprint: 'host-fp-a',
            resourceKey: 'emulator-profile:Pixel_8',
            resourceType: 'EMULATOR_PROFILE',
        }]);
        executeRaw
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(1);

        const result = await claimNextRunForRunner({
            runnerId: 'runner-2',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(result).toEqual({
            runId: 'run-emu',
            testCaseId: 'test-case-emu',
            requiredCapability: 'ANDROID',
            requestedDeviceId: 'emulator-profile:Pixel_8',
            requestedRunnerId: 'runner-2',
            leaseExpiresAt: expect.any(Date),
        });
        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(executeRaw).toHaveBeenCalledTimes(2);
        const [firstQuery] = queryRaw.mock.calls[0];
        expect(firstQuery.values).toContain('emulator-profile:%');
    });

    it('returns null when there is no explicit-device job claimable', async () => {
        queryRaw.mockResolvedValueOnce([]);

        const result = await claimNextRunForRunner({
            runnerId: 'runner-2',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(result).toBeNull();
        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(executeRaw).not.toHaveBeenCalled();
        expect(updateManyRun).not.toHaveBeenCalled();
    });

    it('blocks connected-device claim when same-host lock is already held by another team runner', async () => {
        queryRaw.mockResolvedValueOnce([{
            id: 'run-1',
            testCaseId: 'test-case-1',
            requiredCapability: 'ANDROID',
            requestedDeviceId: 'device-a',
            requestedRunnerId: null,
            hostFingerprint: 'host-fp-a',
            resourceKey: 'connected-device:device-a',
            resourceType: 'CONNECTED_DEVICE',
        }]);
        // Simulate ON CONFLICT from an existing lock held by another team on the same host resource.
        executeRaw
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(0);

        const result = await claimNextRunForRunner({
            runnerId: 'runner-2',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(result).toBeNull();
        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(executeRaw).toHaveBeenCalledTimes(2);
        expect(updateManyRun).not.toHaveBeenCalled();
    });

    it('blocks emulator-profile claim when same-host lock is already held by another team runner', async () => {
        queryRaw.mockResolvedValueOnce([{
            id: 'run-emu',
            testCaseId: 'test-case-emu',
            requiredCapability: 'ANDROID',
            requestedDeviceId: 'emulator-profile:Pixel_8',
            requestedRunnerId: 'runner-2',
            hostFingerprint: 'host-fp-a',
            resourceKey: 'emulator-profile:Pixel_8',
            resourceType: 'EMULATOR_PROFILE',
        }]);
        // Simulate ON CONFLICT from an existing lock held by another team on the same host resource.
        executeRaw
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(0);

        const result = await claimNextRunForRunner({
            runnerId: 'runner-2',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(result).toBeNull();
        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(executeRaw).toHaveBeenCalledTimes(2);
        expect(updateManyRun).not.toHaveBeenCalled();
    });

    it('releases the inserted lock when guarded queue update fails', async () => {
        queryRaw.mockResolvedValueOnce([{
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
        updateManyRun.mockResolvedValueOnce({ count: 0 });

        const result = await claimNextRunForRunner({
            runnerId: 'runner-1',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(result).toBeNull();
        expect(deleteManyLock).toHaveBeenCalledWith({
            where: { runId: 'run-1' },
        });
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

describe('diagnoseNoClaimForRunner', () => {
    beforeEach(() => {
        queryRaw.mockReset();
        runnerDeviceFindMany.mockReset();
        testRunCount.mockReset();
        runnerFindUnique.mockReset();
        runnerDeviceFindMany.mockResolvedValue([
            { deviceId: 'device-a', state: 'ONLINE' },
        ]);
        testRunCount
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(0);
        runnerFindUnique.mockResolvedValue({ hostFingerprint: 'host-fp-a' });
        queryRaw.mockResolvedValue([{ blockedRunCount: 2, resourceKeys: ['connected-device:device-a'] }]);
    });

    it('reports host-resource-lock diagnosis when host lock blocks explicit claimable runs', async () => {
        const diagnosis = await diagnoseNoClaimForRunner({
            runnerId: 'runner-1',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(diagnosis.reasonCode).toBe('RUN_BLOCKED_BY_HOST_RESOURCE_LOCK');
        expect(diagnosis.explicitRequestedRunsBlockedByHostLocks).toBe(2);
        expect(diagnosis.blockedHostResourceKeys).toEqual(['connected-device:device-a']);
    });

    it('reports blocked emulator-profile host resource keys in diagnosis', async () => {
        queryRaw.mockResolvedValueOnce([{ blockedRunCount: 1, resourceKeys: ['emulator-profile:Pixel_8'] }]);

        const diagnosis = await diagnoseNoClaimForRunner({
            runnerId: 'runner-1',
            teamId: 'team-2',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
        });

        expect(diagnosis.reasonCode).toBe('RUN_BLOCKED_BY_HOST_RESOURCE_LOCK');
        expect(diagnosis.blockedHostResourceKeys).toEqual(['emulator-profile:Pixel_8']);
    });
});

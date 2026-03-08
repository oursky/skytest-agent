import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw, transaction } = vi.hoisted(() => ({
    queryRaw: vi.fn(),
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
        transaction.mockReset();
        transaction.mockImplementation(async (callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>) => {
            return callback({ $queryRaw: queryRaw });
        });
    });

    it('claims explicit-device jobs before generic jobs', async () => {
        const leaseExpiresAt = new Date('2026-03-07T02:00:00.000Z');
        queryRaw
            .mockResolvedValueOnce([{
                id: 'run-1',
                testCaseId: 'test-case-1',
                requiredCapability: 'ANDROID',
                requestedDeviceId: 'emulator-profile:android_profile_a',
                leaseExpiresAt,
            }]);

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
            requestedDeviceId: 'emulator-profile:android_profile_a',
            leaseExpiresAt,
        });
        expect(queryRaw).toHaveBeenCalledTimes(1);
        const [firstQuery] = queryRaw.mock.calls[0];
        expect(firstQuery.strings.join('')).toContain('"RunnerDevice"');
        expect(firstQuery.strings.join('')).toContain('LIKE');
        expect(firstQuery.strings.join('')).toContain(`'OFFLINE'`);
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
            leaseExpiresAt,
        });
        expect(queryRaw).toHaveBeenCalledTimes(2);
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

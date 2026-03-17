import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    runnerUpdateMany,
    runnerFindUnique,
    runnerUpdate,
    invalidateTeamAvailabilityCache,
} = vi.hoisted(() => ({
    runnerUpdateMany: vi.fn(),
    runnerFindUnique: vi.fn(),
    runnerUpdate: vi.fn(),
    invalidateTeamAvailabilityCache: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        runner: {
            updateMany: runnerUpdateMany,
            findUnique: runnerFindUnique,
            update: runnerUpdate,
        },
    },
}));

vi.mock('@/lib/runners/availability-service', () => ({
    invalidateTeamAvailabilityCache,
}));

const { registerRunner, heartbeatRunner, shutdownRunner, repairRunnerHostBinding } = await import('@/lib/runners/registration-service');

describe('registration-service', () => {
    beforeEach(() => {
        runnerUpdateMany.mockReset();
        runnerFindUnique.mockReset();
        runnerUpdate.mockReset();
        invalidateTeamAvailabilityCache.mockReset();
    });

    it('returns null when register hostFingerprint does not match runner record', async () => {
        runnerUpdateMany.mockResolvedValue({ count: 0 });

        const result = await registerRunner({
            runnerId: 'runner-1',
            hostFingerprint: 'host-a',
            label: 'Runner',
            kind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
            protocolVersion: '1.0.0',
            runnerVersion: '1.0.0',
        });

        expect(result).toBeNull();
        expect(runnerFindUnique).not.toHaveBeenCalled();
        expect(invalidateTeamAvailabilityCache).not.toHaveBeenCalled();
    });

    it('returns null when heartbeat hostFingerprint does not match runner record', async () => {
        runnerUpdateMany.mockResolvedValue({ count: 0 });

        const result = await heartbeatRunner({
            runnerId: 'runner-1',
            hostFingerprint: 'host-a',
            protocolVersion: '1.0.0',
            runnerVersion: '1.0.0',
        });

        expect(result).toBeNull();
        expect(runnerFindUnique).not.toHaveBeenCalled();
        expect(invalidateTeamAvailabilityCache).not.toHaveBeenCalled();
    });

    it('updates runner when hostFingerprint matches and invalidates team availability cache', async () => {
        const now = new Date('2026-03-13T00:00:00.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);

        runnerUpdateMany.mockResolvedValue({ count: 1 });
        runnerFindUnique.mockResolvedValue({
            id: 'runner-1',
            teamId: 'team-1',
            status: 'ONLINE',
            lastSeenAt: now,
        });

        const result = await registerRunner({
            runnerId: 'runner-1',
            hostFingerprint: 'host-a',
            label: 'Runner',
            kind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
            protocolVersion: '1.0.0',
            runnerVersion: '1.0.0',
        });

        expect(runnerUpdateMany).toHaveBeenCalledWith({
            where: {
                id: 'runner-1',
                hostFingerprint: 'host-a',
            },
            data: {
                label: 'Runner',
                kind: 'MACOS_AGENT',
                capabilities: ['ANDROID'],
                protocolVersion: '1.0.0',
                runnerVersion: '1.0.0',
                status: 'ONLINE',
                lastSeenAt: now,
            },
        });
        expect(result).toEqual({
            id: 'runner-1',
            teamId: 'team-1',
            status: 'ONLINE',
            lastSeenAt: now,
        });
        expect(invalidateTeamAvailabilityCache).toHaveBeenCalledWith('team-1');

        vi.useRealTimers();
    });

    it('shuts down runner and invalidates team availability cache', async () => {
        const now = new Date('2026-03-13T10:00:00.000Z');
        runnerUpdate.mockResolvedValue({
            id: 'runner-1',
            teamId: 'team-1',
            status: 'OFFLINE',
            lastSeenAt: now,
        });

        const result = await shutdownRunner({ runnerId: 'runner-1' });

        expect(result).toEqual({
            id: 'runner-1',
            teamId: 'team-1',
            status: 'OFFLINE',
            lastSeenAt: now,
        });
        expect(invalidateTeamAvailabilityCache).toHaveBeenCalledWith('team-1');
    });

    it('repairs runner host binding and marks runner online', async () => {
        const now = new Date('2026-03-13T12:00:00.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);
        runnerUpdate.mockResolvedValue({
            id: 'runner-1',
            teamId: 'team-1',
            status: 'ONLINE',
            lastSeenAt: now,
        });

        const result = await repairRunnerHostBinding({
            runnerId: 'runner-1',
            hostFingerprint: 'host-b',
            label: 'Runner B',
            kind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
            protocolVersion: '1.0.0',
            runnerVersion: '1.0.0',
        });

        expect(runnerUpdate).toHaveBeenCalledWith({
            where: { id: 'runner-1' },
            data: {
                hostFingerprint: 'host-b',
                label: 'Runner B',
                kind: 'MACOS_AGENT',
                capabilities: ['ANDROID'],
                protocolVersion: '1.0.0',
                runnerVersion: '1.0.0',
                status: 'ONLINE',
                lastSeenAt: now,
            },
            select: {
                id: true,
                teamId: true,
                status: true,
                lastSeenAt: true,
            },
        });
        expect(result).toEqual({
            id: 'runner-1',
            teamId: 'team-1',
            status: 'ONLINE',
            lastSeenAt: now,
        });
        expect(invalidateTeamAvailabilityCache).toHaveBeenCalledWith('team-1');

        vi.useRealTimers();
    });
});

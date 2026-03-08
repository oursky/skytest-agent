import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, update } = vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        runnerToken: {
            findUnique,
            update,
        },
    },
}));

const { authenticateRunnerRequest } = await import('@/lib/runners/auth');

describe('authenticateRunnerRequest', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-07T00:00:00.000Z'));
        findUnique.mockReset();
        update.mockReset();
        update.mockResolvedValue({});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null without bearer token', async () => {
        const result = await authenticateRunnerRequest(new Request('http://localhost/api/runners/v1/register'));
        expect(result).toBeNull();
    });

    it('returns null for revoked credentials', async () => {
        findUnique.mockResolvedValueOnce({
            id: 'token-1',
            teamId: 'team-1',
            runnerId: 'runner-1',
            kind: 'RUNNER',
            revokedAt: new Date('2026-03-06T00:00:00.000Z'),
            expiresAt: new Date('2026-03-08T00:00:00.000Z'),
            runner: { id: 'runner-1', kind: 'MACOS_AGENT', capabilities: ['ANDROID'] },
        });

        const result = await authenticateRunnerRequest(new Request('http://localhost', {
            headers: {
                Authorization: 'Bearer st_runner_test-token',
            },
        }));

        expect(result).toBeNull();
    });

    it('returns null for expired credentials', async () => {
        findUnique.mockResolvedValueOnce({
            id: 'token-1',
            teamId: 'team-1',
            runnerId: 'runner-1',
            kind: 'RUNNER',
            revokedAt: null,
            expiresAt: new Date('2026-03-06T23:59:00.000Z'),
            runner: { id: 'runner-1', kind: 'MACOS_AGENT', capabilities: ['ANDROID'] },
        });

        const result = await authenticateRunnerRequest(new Request('http://localhost', {
            headers: {
                Authorization: 'Bearer st_runner_test-token',
            },
        }));

        expect(result).toBeNull();
    });

    it('marks credentials as rotation required near expiry', async () => {
        findUnique.mockResolvedValueOnce({
            id: 'token-1',
            teamId: 'team-1',
            runnerId: 'runner-1',
            kind: 'RUNNER',
            revokedAt: null,
            expiresAt: new Date('2026-03-07T12:00:00.000Z'),
            runner: { id: 'runner-1', kind: 'MACOS_AGENT', capabilities: ['ANDROID'] },
        });

        const result = await authenticateRunnerRequest(new Request('http://localhost', {
            headers: {
                Authorization: 'Bearer st_runner_test-token',
            },
        }));

        expect(result).toEqual({
            tokenId: 'token-1',
            runnerId: 'runner-1',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
            credentialExpiresAt: new Date('2026-03-07T12:00:00.000Z'),
            rotationRequired: true,
        });
        expect(update).toHaveBeenCalledWith({
            where: { id: 'token-1' },
            data: {
                lastUsedAt: new Date('2026-03-07T00:00:00.000Z'),
            },
        });
    });

    it('accepts valid credentials and marks rotation as not required', async () => {
        findUnique.mockResolvedValueOnce({
            id: 'token-1',
            teamId: 'team-1',
            runnerId: 'runner-1',
            kind: 'RUNNER',
            revokedAt: null,
            expiresAt: new Date('2026-03-12T00:00:00.000Z'),
            runner: { id: 'runner-1', kind: 'MACOS_AGENT', capabilities: ['ANDROID'] },
        });

        const result = await authenticateRunnerRequest(new Request('http://localhost', {
            headers: {
                Authorization: 'Bearer st_runner_test-token',
            },
        }));

        expect(result).toEqual({
            tokenId: 'token-1',
            runnerId: 'runner-1',
            teamId: 'team-1',
            runnerKind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
            credentialExpiresAt: new Date('2026-03-12T00:00:00.000Z'),
            rotationRequired: false,
        });
    });
});

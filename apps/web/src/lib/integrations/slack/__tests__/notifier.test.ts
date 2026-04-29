import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SlackChannelNotFoundError,
    SlackTransientError,
} from '@/lib/integrations/slack/errors';

const {
    findUniqueRun,
    updateManyRun,
    updateRun,
    decryptMock,
    postMessageMock,
    appConfigMock,
} = vi.hoisted(() => ({
    findUniqueRun: vi.fn(),
    updateManyRun: vi.fn(),
    updateRun: vi.fn(),
    decryptMock: vi.fn(),
    postMessageMock: vi.fn(),
    appConfigMock: {
        app: {
            publicBaseUrl: 'https://skytest.dev',
        },
        slack: {
            notifications: {
                maxAttempts: 5,
                claimTtlMs: 90_000,
            },
        },
    },
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findUnique: findUniqueRun,
            updateMany: updateManyRun,
            update: updateRun,
        },
    },
}));

vi.mock('@/lib/security/crypto', () => ({
    decrypt: decryptMock,
}));

vi.mock('@/lib/integrations/slack/client', () => ({
    postMessage: postMessageMock,
}));

vi.mock('@/config/app', () => ({
    config: appConfigMock,
}));

const { notifyRunFailed } = await import('@/lib/integrations/slack/notifier');

function buildFailedRun(overrides?: Partial<{
    slackEnabled: boolean;
    slackChannelId: string | null;
    token: string | null;
    attempts: number;
}>) {
    return {
        id: 'run-1',
        status: 'FAIL',
        testCaseId: 'tc-1',
        triggeredByEmail: 'qa@example.com',
        startedAt: new Date('2026-04-29T07:00:00.000Z'),
        completedAt: new Date('2026-04-29T07:01:00.000Z'),
        error: 'Locator not found',
        slackNotifyAttempts: overrides?.attempts ?? 0,
        testCase: {
            id: 'tc-1',
            name: 'Checkout',
            project: {
                id: 'project-1',
                name: 'Storefront',
                slackEnabled: overrides?.slackEnabled ?? true,
                slackChannelId: overrides?.slackChannelId ?? 'C123',
                slackMessageTemplate: null,
                team: {
                    slackBotTokenEncrypted: overrides?.token ?? 'enc-token',
                },
            },
        },
    };
}

describe('notifyRunFailed', () => {
    beforeEach(() => {
        findUniqueRun.mockReset();
        updateManyRun.mockReset();
        updateRun.mockReset();
        decryptMock.mockReset();
        postMessageMock.mockReset();

        findUniqueRun.mockResolvedValue(buildFailedRun());
        updateManyRun.mockResolvedValue({ count: 1 });
        decryptMock.mockReturnValue('xoxb-token');
        postMessageMock.mockResolvedValue({ timestamp: '1.23' });
        updateRun.mockResolvedValue({ id: 'run-1' });
    });

    it('posts and marks notified when Slack send succeeds', async () => {
        await notifyRunFailed('run-1');

        expect(updateManyRun).toHaveBeenCalledTimes(1);
        expect(postMessageMock).toHaveBeenCalledTimes(1);
        expect(updateRun).toHaveBeenCalledWith({
            where: { id: 'run-1' },
            data: {
                slackNotifiedAt: expect.any(Date),
                slackNotifyClaimedAt: null,
                slackNotifyError: null,
            },
        });
    });

    it('skips when project notifications are disabled', async () => {
        findUniqueRun.mockResolvedValue(buildFailedRun({ slackEnabled: false }));

        await notifyRunFailed('run-1');

        expect(updateManyRun).not.toHaveBeenCalled();
        expect(postMessageMock).not.toHaveBeenCalled();
    });

    it('clears claim on transient errors', async () => {
        postMessageMock.mockRejectedValueOnce(new SlackTransientError('temporary', {
            code: 'upstream_error',
            status: 503,
        }));

        await notifyRunFailed('run-1');

        expect(updateRun).toHaveBeenCalledWith({
            where: { id: 'run-1' },
            data: {
                slackNotifyClaimedAt: null,
            },
        });
    });

    it('marks notified on non-retryable errors', async () => {
        postMessageMock.mockRejectedValueOnce(new SlackChannelNotFoundError('missing', {
            code: 'channel_not_found',
            status: 200,
        }));

        await notifyRunFailed('run-1');

        expect(updateRun).toHaveBeenCalledWith({
            where: { id: 'run-1' },
            data: {
                slackNotifiedAt: expect.any(Date),
                slackNotifyClaimedAt: null,
                slackNotifyError: 'channel_not_found',
            },
        });
    });

    it('exits early when claim was already taken by another caller', async () => {
        updateManyRun.mockResolvedValueOnce({ count: 0 });

        await notifyRunFailed('run-1');

        expect(postMessageMock).not.toHaveBeenCalled();
        expect(updateRun).not.toHaveBeenCalled();
    });
});

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
} = vi.hoisted(() => ({
    findUniqueRun: vi.fn(),
    updateManyRun: vi.fn(),
    updateRun: vi.fn(),
    decryptMock: vi.fn(),
    postMessageMock: vi.fn(),
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

const { notifyRunTerminal } = await import('@/lib/integrations/slack/notifier');

function buildFailedRun(overrides?: Partial<{
    status: 'PASS' | 'FAIL';
    slackEnabled: boolean;
    slackNotifyOn: 'FAILED_ONLY' | 'BOTH_PASSED_AND_FAILED';
    slackChannelId: string | null;
    token: string | null;
    attempts: number;
    displayId: string | null;
}>) {
    return {
        id: 'run-1',
        status: overrides?.status ?? 'FAIL',
        testCaseId: 'tc-1',
        triggeredByEmail: 'test@example.com',
        startedAt: new Date('2026-04-29T07:00:00.000Z'),
        completedAt: new Date('2026-04-29T07:01:00.000Z'),
        error: 'Locator not found',
        slackNotifyAttempts: overrides?.attempts ?? 0,
        testCase: {
            id: 'tc-1',
            displayId: overrides && 'displayId' in overrides ? overrides.displayId : 'TC-001',
            name: 'Checkout',
            project: {
                id: 'project-1',
                name: 'Storefront',
                slackEnabled: overrides?.slackEnabled ?? true,
                slackNotifyOn: overrides?.slackNotifyOn ?? 'FAILED_ONLY',
                slackChannelId: overrides?.slackChannelId ?? 'C123',
                slackFailureTemplate: null,
                slackSuccessTemplate: null,
                team: {
                    slackBotTokenEncrypted: overrides?.token ?? 'enc-token',
                },
            },
        },
    };
}

describe('notifyRunTerminal', () => {
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
        await notifyRunTerminal('run-1');

        expect(updateManyRun).toHaveBeenCalledTimes(1);
        expect(postMessageMock).toHaveBeenCalledTimes(1);
        expect(postMessageMock).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining(':x: *Test Failed* Storefront TC-001'),
        });
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

        await notifyRunTerminal('run-1');

        expect(updateManyRun).not.toHaveBeenCalled();
        expect(postMessageMock).not.toHaveBeenCalled();
    });

    it('clears claim on transient errors', async () => {
        postMessageMock.mockRejectedValueOnce(new SlackTransientError('temporary', {
            code: 'upstream_error',
            status: 503,
        }));

        await notifyRunTerminal('run-1');

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

        await notifyRunTerminal('run-1');

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

        await notifyRunTerminal('run-1');

        expect(postMessageMock).not.toHaveBeenCalled();
        expect(updateRun).not.toHaveBeenCalled();
    });

    it('marks run as exhausted on repeated unexpected errors', async () => {
        findUniqueRun.mockResolvedValueOnce(buildFailedRun({ attempts: 4 }));
        decryptMock.mockImplementationOnce(() => {
            throw new Error('decrypt failed');
        });

        await notifyRunTerminal('run-1');

        expect(updateRun).toHaveBeenCalledWith({
            where: { id: 'run-1' },
            data: {
                slackNotifiedAt: expect.any(Date),
                slackNotifyClaimedAt: null,
                slackNotifyError: 'unexpected:max_attempts',
            },
        });
    });

    it('skips PASS runs when notify mode is FAILED_ONLY', async () => {
        findUniqueRun.mockResolvedValue(buildFailedRun({
            status: 'PASS',
            slackNotifyOn: 'FAILED_ONLY',
        }));

        await notifyRunTerminal('run-1');

        expect(updateManyRun).not.toHaveBeenCalled();
        expect(postMessageMock).not.toHaveBeenCalled();
    });

    it('posts PASS runs when notify mode is BOTH_PASSED_AND_FAILED', async () => {
        findUniqueRun.mockResolvedValue(buildFailedRun({
            status: 'PASS',
            slackNotifyOn: 'BOTH_PASSED_AND_FAILED',
        }));

        await notifyRunTerminal('run-1');

        expect(postMessageMock).toHaveBeenCalledTimes(1);
        expect(postMessageMock).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining('*Duration:* 1m00s'),
        });
    });

    it('wraps truncated failure errors in code fences', async () => {
        findUniqueRun.mockResolvedValueOnce({
            ...buildFailedRun({ status: 'FAIL' }),
            error: `Error details: ${'x'.repeat(700)}`,
        });

        await notifyRunTerminal('run-1');

        expect(postMessageMock).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining('*Error:*\n```'),
        });
        expect(postMessageMock).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining('...\n```'),
        });
    });

    it('does not fall back to internal test case id when display id is empty', async () => {
        findUniqueRun.mockResolvedValue(buildFailedRun({ displayId: null }));

        await notifyRunTerminal('run-1');

        expect(postMessageMock).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining(':x: *Test Failed* Storefront \n*Test Case:* Checkout'),
        });
    });
});

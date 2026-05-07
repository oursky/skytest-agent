import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlackChannelNotFoundError } from '@/lib/integrations/slack/errors';

const mocks = vi.hoisted(() => ({
    guardProjectRouteRequest: vi.fn(),
    prisma: {
        project: {
            findUnique: vi.fn(),
        },
    },
    decrypt: vi.fn(),
    postMessage: vi.fn(),
    joinConversation: vi.fn(),
}));

vi.mock('@/lib/security/project-route-access', () => ({
    guardProjectRouteRequest: mocks.guardProjectRouteRequest,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: mocks.prisma,
}));

vi.mock('@/lib/security/crypto', () => ({
    decrypt: mocks.decrypt,
}));

vi.mock('@/lib/integrations/slack/client', () => ({
    postMessage: mocks.postMessage,
    joinConversation: mocks.joinConversation,
}));

const { POST } = await import('@/app/api/projects/[id]/slack/test/route');

function buildProject(overrides?: Partial<{
    token: string | null;
    enabled: boolean;
    channelId: string | null;
}>) {
    return {
        id: 'project-1',
        name: 'Storefront',
        slackEnabled: overrides?.enabled ?? true,
        slackChannelId: overrides?.channelId ?? 'C123',
        slackFailureTemplate: null,
        slackSuccessTemplate: null,
        team: {
            slackBotTokenEncrypted: overrides && 'token' in overrides ? overrides.token ?? null : 'enc-token',
        },
    };
}

describe('/api/projects/[id]/slack/test', () => {
    beforeEach(() => {
        mocks.guardProjectRouteRequest.mockReset();
        mocks.prisma.project.findUnique.mockReset();
        mocks.decrypt.mockReset();
        mocks.postMessage.mockReset();
        mocks.joinConversation.mockReset();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-07T09:33:00.000Z'));

        mocks.guardProjectRouteRequest.mockResolvedValue({
            ok: true,
            userId: 'user-1',
            params: { id: 'project-1' },
        });
        mocks.prisma.project.findUnique.mockResolvedValue(buildProject());
        mocks.decrypt.mockReturnValue('xoxb-token');
        mocks.postMessage.mockResolvedValue({ timestamp: '1.23' });
        mocks.joinConversation.mockResolvedValue({
            id: 'C123',
            name: 'alerts',
            isPrivate: false,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sends a failed Slack test message by default', async () => {
        const response = await POST(new Request('http://localhost:3000/api/projects/project-1/slack/test', {
            method: 'POST',
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(mocks.postMessage).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining(':x: *Test Failed* CASE-TEST-001'),
        });
        expect(mocks.postMessage).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining('^Run - {date_short} {time}|Run - 7 May 2026, 09:33 UTC>'),
        });
        expect(mocks.postMessage).not.toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining('http://localhost:3000/test-cases/'),
        });
        expect(mocks.postMessage).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining('*Started:* <!date^1778146380^{date_num} {time_secs}|7 May 2026, 09:33 UTC>'),
        });
    });

    it('sends a passed Slack test message when status is PASS', async () => {
        const response = await POST(new Request('http://localhost:3000/api/projects/project-1/slack/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'PASS' }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.postMessage).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining(':white_check_mark: *Test Passed* CASE-TEST-001'),
        });
        expect(mocks.postMessage).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channel: 'C123',
            text: expect.stringContaining('*Duration:* 42s'),
        });
    });

    it('returns TEAM_TOKEN_MISSING when team token is absent', async () => {
        mocks.prisma.project.findUnique.mockResolvedValueOnce(buildProject({ token: null }));

        const response = await POST(new Request('http://localhost:3000/api/projects/project-1/slack/test', {
            method: 'POST',
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(409);
        expect(mocks.postMessage).not.toHaveBeenCalled();
    });

    it('returns PROJECT_SLACK_NOT_CONFIGURED when project Slack settings are incomplete', async () => {
        mocks.prisma.project.findUnique.mockResolvedValueOnce(buildProject({
            enabled: false,
            channelId: null,
        }));

        const response = await POST(new Request('http://localhost:3000/api/projects/project-1/slack/test', {
            method: 'POST',
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(409);
        expect(payload).toMatchObject({ error: 'PROJECT_SLACK_NOT_CONFIGURED' });
        expect(mocks.postMessage).not.toHaveBeenCalled();
    });

    it('maps channel errors to INVALID_CHANNEL', async () => {
        mocks.postMessage.mockRejectedValueOnce(new SlackChannelNotFoundError('missing', {
            code: 'channel_not_found',
            status: 200,
        }));

        const response = await POST(new Request('http://localhost:3000/api/projects/project-1/slack/test', {
            method: 'POST',
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toMatchObject({
            error: 'INVALID_CHANNEL',
            field: 'slackChannelId',
        });
    });

    it('joins channel and retries once when bot is not in channel', async () => {
        mocks.postMessage
            .mockRejectedValueOnce(new SlackChannelNotFoundError('not in channel', {
                code: 'not_in_channel',
                status: 200,
            }))
            .mockResolvedValueOnce({ timestamp: '2.34' });

        const response = await POST(new Request('http://localhost:3000/api/projects/project-1/slack/test', {
            method: 'POST',
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(mocks.joinConversation).toHaveBeenCalledWith({
            token: 'xoxb-token',
            channelId: 'C123',
        });
        expect(mocks.postMessage).toHaveBeenCalledTimes(2);
    });

    it('keeps INVALID_CHANNEL response when auto-join fails', async () => {
        mocks.postMessage.mockRejectedValueOnce(new SlackChannelNotFoundError('not in channel', {
            code: 'not_in_channel',
            status: 200,
        }));
        mocks.joinConversation.mockRejectedValueOnce(new Error('missing_scope'));

        const response = await POST(new Request('http://localhost:3000/api/projects/project-1/slack/test', {
            method: 'POST',
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toMatchObject({
            error: 'INVALID_CHANNEL',
            field: 'slackChannelId',
        });
        expect(mocks.postMessage).toHaveBeenCalledTimes(1);
    });
});

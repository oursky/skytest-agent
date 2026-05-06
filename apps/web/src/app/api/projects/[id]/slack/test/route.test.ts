import { beforeEach, describe, expect, it, vi } from 'vitest';
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
}));

const { POST } = await import('@/app/api/projects/[id]/slack/test/route');

function buildProject(overrides?: Partial<{
    token: string | null;
    enabled: boolean;
    channelId: string | null;
}>) {
    return {
        name: 'Storefront',
        slackEnabled: overrides?.enabled ?? true,
        slackChannelId: overrides?.channelId ?? 'C123',
        slackMessageTemplate: 'Failed run {runId}',
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

        mocks.guardProjectRouteRequest.mockResolvedValue({
            ok: true,
            userId: 'user-1',
            params: { id: 'project-1' },
        });
        mocks.prisma.project.findUnique.mockResolvedValue(buildProject());
        mocks.decrypt.mockReturnValue('xoxb-token');
        mocks.postMessage.mockResolvedValue({ timestamp: '1.23' });
    });

    it('sends a Slack test message for configured project', async () => {
        const response = await POST(new Request('http://localhost/api/projects/project-1/slack/test', {
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
            text: expect.stringContaining('Test message from SkyTest'),
        });
    });

    it('returns TEAM_TOKEN_MISSING when team token is absent', async () => {
        mocks.prisma.project.findUnique.mockResolvedValueOnce(buildProject({ token: null }));

        const response = await POST(new Request('http://localhost/api/projects/project-1/slack/test', {
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

        const response = await POST(new Request('http://localhost/api/projects/project-1/slack/test', {
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

        const response = await POST(new Request('http://localhost/api/projects/project-1/slack/test', {
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
});

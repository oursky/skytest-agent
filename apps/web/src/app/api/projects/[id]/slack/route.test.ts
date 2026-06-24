import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SlackAuthError,
    SlackChannelNotFoundError,
    SlackTransientError,
} from '@/lib/integrations/slack/errors';

const mocks = vi.hoisted(() => ({
    guardProjectRouteRequest: vi.fn(),
    prisma: {
        project: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
    },
    decrypt: vi.fn(),
    getConversationInfo: vi.fn(),
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
    getConversationInfo: mocks.getConversationInfo,
}));

const { GET, PUT } = await import('@/app/api/projects/[id]/slack/route');

function buildProject(overrides?: Partial<{
    token: string | null;
    slackEnabled: boolean;
    slackNotifyOn: 'FAILED_ONLY' | 'BOTH_PASSED_AND_FAILED';
    channelId: string | null;
    channelName: string | null;
    failureTemplate: string | null;
    successTemplate: string | null;
}>) {
    return {
        id: 'project-1',
        slackEnabled: overrides?.slackEnabled ?? false,
        slackNotifyOn: overrides?.slackNotifyOn ?? 'FAILED_ONLY',
        slackChannelId: overrides?.channelId ?? null,
        slackChannelName: overrides?.channelName ?? null,
        slackFailureTemplate: overrides?.failureTemplate ?? null,
        slackSuccessTemplate: overrides?.successTemplate ?? null,
        slackGroupNotifyEnabled: false,
        slackGroupFailureTemplate: null,
        slackGroupSuccessTemplate: null,
        slackUpdatedAt: new Date('2026-04-29T00:00:00.000Z'),
        team: {
            slackBotTokenEncrypted: overrides && 'token' in overrides ? overrides.token ?? null : 'enc-token',
        },
    };
}

describe('/api/projects/[id]/slack', () => {
    beforeEach(() => {
        mocks.guardProjectRouteRequest.mockReset();
        mocks.prisma.project.findUnique.mockReset();
        mocks.prisma.project.update.mockReset();
        mocks.decrypt.mockReset();
        mocks.getConversationInfo.mockReset();

        mocks.guardProjectRouteRequest.mockResolvedValue({
            ok: true,
            userId: 'user-1',
            params: { id: 'project-1' },
        });
        mocks.prisma.project.findUnique.mockResolvedValue(buildProject());
        mocks.prisma.project.update.mockImplementation(async (input: { data: Record<string, unknown> }) => ({
            slackEnabled: input.data.slackEnabled,
            slackNotifyOn: input.data.slackNotifyOn,
            slackChannelId: input.data.slackChannelId,
            slackChannelName: input.data.slackChannelName,
            slackFailureTemplate: input.data.slackFailureTemplate,
            slackSuccessTemplate: input.data.slackSuccessTemplate,
            slackGroupNotifyEnabled: input.data.slackGroupNotifyEnabled,
            slackGroupFailureTemplate: input.data.slackGroupFailureTemplate,
            slackGroupSuccessTemplate: input.data.slackGroupSuccessTemplate,
            slackUpdatedAt: new Date('2026-04-29T01:00:00.000Z'),
            team: {
                slackBotTokenEncrypted: 'enc-token',
            },
        }));
        mocks.decrypt.mockReturnValue('xoxb-valid');
        mocks.getConversationInfo.mockResolvedValue({
            id: 'C123',
            name: 'alerts',
            isPrivate: false,
        });
    });

    it('returns project slack settings and parent token flag', async () => {
        const response = await GET(new Request('http://localhost/api/projects/project-1/slack'), {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toMatchObject({
            slackEnabled: false,
            slackNotifyOn: 'FAILED_ONLY',
            parentTeamHasToken: true,
        });
    });

    it('rejects enabled config when team token is missing', async () => {
        mocks.prisma.project.findUnique.mockResolvedValueOnce(buildProject({ token: null }));

        const response = await PUT(new Request('http://localhost/api/projects/project-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                slackEnabled: true,
                slackChannelId: 'C123',
            }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(409);
        expect(mocks.prisma.project.update).not.toHaveBeenCalled();
    });

    it('rejects invalid channel and keeps settings unchanged', async () => {
        mocks.getConversationInfo.mockRejectedValueOnce(new SlackChannelNotFoundError('missing', {
            code: 'channel_not_found',
            status: 200,
        }));

        const response = await PUT(new Request('http://localhost/api/projects/project-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                slackEnabled: true,
                slackChannelId: 'C404',
            }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(400);
        expect(mocks.prisma.project.update).not.toHaveBeenCalled();
    });

    it('maps retryable Slack errors to SLACK_UPSTREAM', async () => {
        mocks.getConversationInfo.mockRejectedValueOnce(new SlackTransientError('temporary', {
            code: 'upstream_error',
            status: 503,
        }));

        const response = await PUT(new Request('http://localhost/api/projects/project-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                slackEnabled: true,
                slackChannelId: 'C123',
            }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(502);
        expect(payload).toMatchObject({ error: 'SLACK_UPSTREAM' });
        expect(mocks.prisma.project.update).not.toHaveBeenCalled();
    });

    it('saves validated settings and caches channel name', async () => {
        const response = await PUT(new Request('http://localhost/api/projects/project-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                slackEnabled: true,
                slackChannelId: 'C123',
                slackFailureTemplate: 'Failed run {testRunLink}',
                slackSuccessTemplate: 'Passed run {durationMinSec}',
            }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.prisma.project.update).toHaveBeenCalledWith({
            where: { id: 'project-1' },
            data: expect.objectContaining({
                slackEnabled: true,
                slackNotifyOn: 'FAILED_ONLY',
                slackChannelId: 'C123',
                slackChannelName: 'alerts',
                slackFailureTemplate: 'Failed run {testRunLink}',
                slackSuccessTemplate: 'Passed run {durationMinSec}',
            }),
            select: expect.any(Object),
        });
    });

    it('allows enabling without a channel and skips channel validation', async () => {
        const response = await PUT(new Request('http://localhost/api/projects/project-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                slackEnabled: true,
                slackGroupNotifyEnabled: true,
            }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.getConversationInfo).not.toHaveBeenCalled();
        expect(mocks.prisma.project.update).toHaveBeenCalledWith({
            where: { id: 'project-1' },
            data: expect.objectContaining({
                slackEnabled: true,
                slackChannelId: null,
                slackChannelName: null,
            }),
            select: expect.any(Object),
        });
    });

    it('persists all-completed notify mode', async () => {
        const response = await PUT(new Request('http://localhost/api/projects/project-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                slackEnabled: true,
                slackNotifyOn: 'BOTH_PASSED_AND_FAILED',
                slackChannelId: 'C123',
                slackFailureTemplate: 'Fail {testRunLink}',
                slackSuccessTemplate: 'Pass {durationMinSec}',
            }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.prisma.project.update).toHaveBeenCalledWith({
            where: { id: 'project-1' },
            data: expect.objectContaining({
                slackNotifyOn: 'BOTH_PASSED_AND_FAILED',
            }),
            select: expect.any(Object),
        });
    });

    it('allows disabled config updates without team token validation', async () => {
        mocks.prisma.project.findUnique.mockResolvedValueOnce(buildProject({ token: null }));

        const response = await PUT(new Request('http://localhost/api/projects/project-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                slackEnabled: false,
                slackChannelId: 'C123',
            }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.getConversationInfo).not.toHaveBeenCalled();
    });

    it('clears cached channel name when disabled settings change channel id', async () => {
        mocks.prisma.project.findUnique.mockResolvedValueOnce(buildProject({
            slackEnabled: false,
            channelId: 'COLD',
            channelName: 'old-channel',
        }));

        const response = await PUT(new Request('http://localhost/api/projects/project-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                slackEnabled: false,
                slackChannelId: 'CNEW',
            }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.prisma.project.update).toHaveBeenCalledWith({
            where: { id: 'project-1' },
            data: expect.objectContaining({
                slackEnabled: false,
                slackChannelId: 'CNEW',
                slackChannelName: null,
            }),
            select: expect.any(Object),
        });
    });

    it('maps auth errors to TEAM_TOKEN_INVALID', async () => {
        mocks.getConversationInfo.mockRejectedValueOnce(new SlackAuthError('invalid', {
            code: 'invalid_auth',
            status: 200,
        }));

        const response = await PUT(new Request('http://localhost/api/projects/project-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                slackEnabled: true,
                slackChannelId: 'C123',
            }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });

        expect(response.status).toBe(409);
        expect(mocks.prisma.project.update).not.toHaveBeenCalled();
    });
});

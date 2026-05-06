import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SlackAuthError,
    SlackTransientError,
} from '@/lib/integrations/slack/errors';

const mocks = vi.hoisted(() => ({
    guardTeamRouteRequest: vi.fn(),
    prisma: {
        team: {
            findUnique: vi.fn(),
        },
    },
    decrypt: vi.fn(),
    authTest: vi.fn(),
}));

vi.mock('@/lib/security/team-route-access', () => ({
    guardTeamRouteRequest: mocks.guardTeamRouteRequest,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: mocks.prisma,
}));

vi.mock('@/lib/security/crypto', () => ({
    decrypt: mocks.decrypt,
}));

vi.mock('@/lib/integrations/slack/client', () => ({
    authTest: mocks.authTest,
}));

const { POST } = await import('@/app/api/teams/[id]/slack/test/route');

describe('/api/teams/[id]/slack/test', () => {
    beforeEach(() => {
        mocks.guardTeamRouteRequest.mockReset();
        mocks.prisma.team.findUnique.mockReset();
        mocks.decrypt.mockReset();
        mocks.authTest.mockReset();

        mocks.guardTeamRouteRequest.mockResolvedValue({
            ok: true,
            teamId: 'team-1',
            userId: 'user-1',
            params: { id: 'team-1' },
        });
        mocks.prisma.team.findUnique.mockResolvedValue({
            slackBotTokenEncrypted: 'enc-token',
        });
        mocks.decrypt.mockReturnValue('xoxb-valid');
        mocks.authTest.mockResolvedValue({
            teamId: 'T1',
            teamName: 'Workspace',
            botUserId: 'U1',
        });
    });

    it('uses saved token when request does not provide token', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/slack/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.authTest).toHaveBeenCalledWith('xoxb-valid');
        expect(payload).toMatchObject({ success: true, slackTeamName: 'Workspace' });
    });

    it('returns conflict when no saved token exists', async () => {
        mocks.prisma.team.findUnique.mockResolvedValueOnce({
            slackBotTokenEncrypted: null,
        });

        const response = await POST(new Request('http://localhost/api/teams/team-1/slack/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(409);
        expect(payload).toMatchObject({ error: 'TEAM_TOKEN_MISSING' });
    });

    it('maps invalid auth errors to conflict', async () => {
        mocks.authTest.mockRejectedValueOnce(new SlackAuthError('invalid', {
            code: 'invalid_auth',
            status: 200,
        }));

        const response = await POST(new Request('http://localhost/api/teams/team-1/slack/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(409);
        expect(payload).toMatchObject({ error: 'TEAM_TOKEN_INVALID' });
    });

    it('maps transient Slack errors to bad gateway', async () => {
        mocks.authTest.mockRejectedValueOnce(new SlackTransientError('temporary', {
            code: 'upstream_error',
            status: 503,
        }));

        const response = await POST(new Request('http://localhost/api/teams/team-1/slack/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(502);
        expect(payload).toMatchObject({ error: 'SLACK_UPSTREAM' });
    });
});

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
            update: vi.fn(),
        },
    },
    encrypt: vi.fn(),
    authTest: vi.fn(),
}));

vi.mock('@/lib/security/team-route-access', () => ({
    guardTeamRouteRequest: mocks.guardTeamRouteRequest,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: mocks.prisma,
}));

vi.mock('@/lib/security/crypto', () => ({
    encrypt: mocks.encrypt,
}));

vi.mock('@/lib/integrations/slack/client', () => ({
    authTest: mocks.authTest,
}));

const { GET, PUT, DELETE } = await import('@/app/api/teams/[id]/slack/route');

describe('/api/teams/[id]/slack', () => {
    beforeEach(() => {
        mocks.guardTeamRouteRequest.mockReset();
        mocks.prisma.team.findUnique.mockReset();
        mocks.prisma.team.update.mockReset();
        mocks.encrypt.mockReset();
        mocks.authTest.mockReset();

        mocks.guardTeamRouteRequest.mockResolvedValue({
            ok: true,
            teamId: 'team-1',
            userId: 'user-1',
            params: { id: 'team-1' },
        });
        mocks.encrypt.mockImplementation((value: string) => `enc:${value}`);
        mocks.authTest.mockResolvedValue({
            teamId: 'T1',
            teamName: 'Workspace',
            botUserId: 'U1',
        });
    });

    it('returns token status without leaking token', async () => {
        mocks.prisma.team.findUnique.mockResolvedValue({
            slackBotTokenEncrypted: 'enc:xoxb-secret',
            slackTeamName: 'Workspace',
            slackBotUserId: 'U1',
            slackConfigUpdatedAt: new Date('2026-04-29T00:00:00.000Z'),
        });

        const response = await GET(new Request('http://localhost/api/teams/team-1/slack'), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toMatchObject({
            hasToken: true,
            slackTeamName: 'Workspace',
            slackBotUserId: 'U1',
        });
        expect(JSON.stringify(payload)).not.toContain('xoxb-secret');
    });

    it('stores encrypted token after auth test passes', async () => {
        const response = await PUT(new Request('http://localhost/api/teams/team-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: 'xoxb-valid' }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.authTest).toHaveBeenCalledWith('xoxb-valid');
        expect(mocks.prisma.team.update).toHaveBeenCalledWith({
            where: { id: 'team-1' },
            data: expect.objectContaining({
                slackBotTokenEncrypted: 'enc:xoxb-valid',
                slackTeamId: 'T1',
                slackTeamName: 'Workspace',
                slackBotUserId: 'U1',
            }),
        });
    });

    it('returns conflict for invalid Slack token', async () => {
        mocks.authTest.mockRejectedValueOnce(new SlackAuthError('invalid', {
            code: 'invalid_auth',
            status: 200,
        }));

        const response = await PUT(new Request('http://localhost/api/teams/team-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: 'xoxb-invalid' }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(409);
        expect(payload).toMatchObject({ error: 'TEAM_TOKEN_INVALID' });
        expect(mocks.prisma.team.update).not.toHaveBeenCalled();
    });

    it('returns bad gateway for transient Slack errors', async () => {
        mocks.authTest.mockRejectedValueOnce(new SlackTransientError('temporary', {
            code: 'upstream_error',
            status: 503,
        }));

        const response = await PUT(new Request('http://localhost/api/teams/team-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: 'xoxb-invalid' }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(502);
        expect(payload).toMatchObject({ error: 'SLACK_UPSTREAM' });
        expect(mocks.prisma.team.update).not.toHaveBeenCalled();
    });

    it('returns validation error for invalid JSON payload', async () => {
        const response = await PUT(new Request('http://localhost/api/teams/team-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: '{"token":',
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toMatchObject({ error: 'INVALID_PAYLOAD' });
        expect(mocks.prisma.team.update).not.toHaveBeenCalled();
    });

    it('returns token-required code when token is empty', async () => {
        const response = await PUT(new Request('http://localhost/api/teams/team-1/slack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: '   ' }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toMatchObject({ error: 'TEAM_TOKEN_REQUIRED', field: 'token' });
        expect(mocks.prisma.team.update).not.toHaveBeenCalled();
    });

    it('passes through guard errors for non-members', async () => {
        mocks.guardTeamRouteRequest.mockResolvedValueOnce({
            ok: false,
            response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
        });

        const response = await GET(new Request('http://localhost/api/teams/team-1/slack'), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        expect(response.status).toBe(403);
    });

    it('clears stored Slack fields on DELETE', async () => {
        const response = await DELETE(new Request('http://localhost/api/teams/team-1/slack', {
            method: 'DELETE',
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.prisma.team.update).toHaveBeenCalledWith({
            where: { id: 'team-1' },
            data: {
                slackBotTokenEncrypted: null,
                slackTeamId: null,
                slackTeamName: null,
                slackBotUserId: null,
                slackConfigUpdatedAt: null,
            },
        });
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    guardTeamRouteRequest: vi.fn(),
    prisma: {
        team: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
    },
    decrypt: vi.fn(),
    encrypt: vi.fn(),
    maskApiKey: vi.fn(),
}));

vi.mock('@/lib/security/team-route-access', () => ({
    guardTeamRouteRequest: mocks.guardTeamRouteRequest,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: mocks.prisma,
}));

vi.mock('@/lib/security/crypto', () => ({
    decrypt: mocks.decrypt,
    encrypt: mocks.encrypt,
    maskApiKey: mocks.maskApiKey,
}));

const { GET, POST, DELETE } = await import('@/app/api/teams/[id]/ai-key/route');

describe('/api/teams/[id]/ai-key', () => {
    beforeEach(() => {
        mocks.guardTeamRouteRequest.mockReset();
        mocks.prisma.team.findUnique.mockReset();
        mocks.prisma.team.update.mockReset();
        mocks.decrypt.mockReset();
        mocks.encrypt.mockReset();
        mocks.maskApiKey.mockReset();

        mocks.guardTeamRouteRequest.mockResolvedValue({
            ok: true,
            teamId: 'team-1',
            userId: 'user-1',
            params: { id: 'team-1' },
        });

        mocks.encrypt.mockImplementation((value: string) => `enc:${value}`);
        mocks.decrypt.mockImplementation((value: string) => value.replace('enc:', ''));
        mocks.maskApiKey.mockImplementation((value: string) => `masked:${value.slice(0, 4)}`);
    });

    it('returns providerConfig on GET even when key is missing', async () => {
        mocks.prisma.team.findUnique.mockResolvedValue({
            openRouterKeyEncrypted: null,
            openRouterKeyUpdatedAt: null,
            aiProvider: null,
            aiBaseUrl: null,
            aiMainModel: null,
            aiPlanningModel: null,
            aiInsightModel: null,
            aiTemperature: null,
        });

        const response = await GET(new Request('http://localhost/api/teams/team-1/ai-key'), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.hasKey).toBe(false);
        expect(payload.providerConfig).toMatchObject({
            provider: 'openrouter',
            baseUrl: null,
            mainModel: null,
            planningModel: null,
            insightModel: null,
            temperature: null,
        });
    });

    it('accepts non-empty key without sk- prefix and stores provider config', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                apiKey: 'copilot-token-123',
                providerConfig: {
                    provider: 'openai-compatible',
                    baseUrl: 'https://api.openai.com/v1',
                    mainModel: 'gpt-5.3-codex',
                    planningModel: 'gpt-5.3-mini',
                    insightModel: 'gpt-5.3-mini',
                    temperature: 0.3,
                },
            }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        const payload = await response.json();
        expect(response.status).toBe(200);
        expect(mocks.prisma.team.update).toHaveBeenCalledWith({
            where: { id: 'team-1' },
            data: expect.objectContaining({
                openRouterKeyEncrypted: 'enc:copilot-token-123',
                aiProvider: 'OPENAI',
                aiBaseUrl: 'https://api.openai.com/v1',
                aiMainModel: 'gpt-5.3-codex',
                aiPlanningModel: 'gpt-5.3-mini',
                aiInsightModel: 'gpt-5.3-mini',
                aiTemperature: 0.3,
            }),
        });
        expect(payload.success).toBe(true);
        expect(payload.providerConfig.provider).toBe('openai-compatible');
    });

    it('rejects empty key', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: '   ' }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        const payload = await response.json();
        expect(response.status).toBe(400);
        expect(payload.error).toBe('API key is required');
    });

    it('clears key on DELETE and preserves provider config fields', async () => {
        const response = await DELETE(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'DELETE',
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.prisma.team.update).toHaveBeenCalledWith({
            where: { id: 'team-1' },
            data: {
                openRouterKeyEncrypted: null,
                openRouterKeyUpdatedAt: null,
            },
        });
    });
});

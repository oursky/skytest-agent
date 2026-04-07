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
            aiMainModelFamily: null,
            aiPlanningModel: null,
            aiPlanningModelFamily: null,
            aiInsightModel: null,
            aiInsightModelFamily: null,
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
            mainModelFamily: null,
            planningModel: null,
            planningModelFamily: null,
            insightModel: null,
            insightModelFamily: null,
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
                    mainModelFamily: 'gpt-5',
                    planningModel: 'gpt-5.3-mini',
                    planningModelFamily: 'gpt-5',
                    insightModel: 'gpt-5.3-mini',
                    insightModelFamily: 'gpt-5',
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
                aiMainModelFamily: 'gpt-5',
                aiPlanningModel: 'gpt-5.3-mini',
                aiPlanningModelFamily: 'gpt-5',
                aiInsightModel: 'gpt-5.3-mini',
                aiInsightModelFamily: 'gpt-5',
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
        expect(payload).toMatchObject({
            error: 'Please fix the highlighted fields',
            code: 'VALIDATION_ERROR',
            details: {
                fieldErrors: {
                    apiKey: 'API key is required',
                },
            },
        });
    });

    it('updates provider config without re-posting api key', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                providerConfig: {
                    provider: 'openrouter',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    mainModel: 'google/gemini-3.1-flash-lite-preview',
                    mainModelFamily: 'gemini',
                    planningModel: 'qwen/qwen3.5-27b',
                    planningModelFamily: 'qwen3.5',
                    insightModel: 'qwen/qwen3.5-27b',
                    insightModelFamily: 'qwen3.5',
                    temperature: 0.2,
                },
            }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        expect(response.status).toBe(200);
        expect(mocks.prisma.team.update).toHaveBeenCalledWith({
            where: { id: 'team-1' },
            data: expect.objectContaining({
                aiProvider: 'OPENROUTER',
                aiBaseUrl: 'https://openrouter.ai/api/v1',
                aiMainModel: 'google/gemini-3.1-flash-lite-preview',
                aiMainModelFamily: 'gemini',
                aiPlanningModel: 'qwen/qwen3.5-27b',
                aiPlanningModelFamily: 'qwen3.5',
                aiInsightModel: 'qwen/qwen3.5-27b',
                aiInsightModelFamily: 'qwen3.5',
                aiTemperature: 0.2,
            }),
        });
        const data = mocks.prisma.team.update.mock.calls[0]?.[0]?.data as Record<string, unknown> | undefined;
        expect(data).toBeDefined();
        expect(data).not.toHaveProperty('openRouterKeyEncrypted');
    });

    it('rejects negative temperature', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                providerConfig: {
                    provider: 'openrouter',
                    temperature: -0.1,
                },
            }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        const payload = await response.json();
        expect(response.status).toBe(400);
        expect(payload).toMatchObject({
            error: 'Please fix the highlighted fields',
            code: 'VALIDATION_ERROR',
            details: {
                fieldErrors: {
                    temperature: 'Temperature must be greater than or equal to 0',
                },
            },
        });
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

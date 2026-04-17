import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    guardTeamRouteRequest: vi.fn(),
    validateRuntimeRequestUrl: vi.fn(),
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

vi.mock('@/lib/security/url-security-runtime', () => ({
    validateRuntimeRequestUrl: mocks.validateRuntimeRequestUrl,
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
        mocks.validateRuntimeRequestUrl.mockReset();
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
        mocks.validateRuntimeRequestUrl.mockResolvedValue({ valid: true });
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
        expect(payload.keyInvalid).toBe(false);
        expect(payload.keyInvalidReason).toBeNull();
    });

    it('flags invalid stored keys on GET without leaking plaintext', async () => {
        const rawInvalidKey = 'copilot-token✅123';
        mocks.prisma.team.findUnique.mockResolvedValue({
            openRouterKeyEncrypted: `enc:${rawInvalidKey}`,
            openRouterKeyUpdatedAt: new Date('2026-04-17T00:00:00.000Z'),
            aiProvider: 'OPENROUTER',
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
        expect(payload).toMatchObject({
            hasKey: true,
            keyInvalid: true,
            keyInvalidReason: 'non_ascii',
        });
        expect(JSON.stringify(payload)).not.toContain(rawInvalidKey);
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

    it('rejects provided key shorter than minimum length', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: 'abc1234' }),
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
                    apiKey: 'API key must be at least 8 characters',
                },
            },
        });
    });

    it('rejects key containing non-ASCII characters', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: 'copilot-token✅123' }),
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
                    apiKey: 'API key must use visible ASCII characters only (no spaces, newlines, or emojis)',
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
                    mainModel: 'qwen/qwen3.6-plus',
                    mainModelFamily: 'qwen3.6',
                    planningModel: 'qwen/qwen3.6-plus',
                    planningModelFamily: 'qwen3.6',
                    insightModel: 'qwen/qwen3.6-plus',
                    insightModelFamily: 'qwen3.6',
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
                aiMainModel: 'qwen/qwen3.6-plus',
                aiMainModelFamily: 'qwen3.6',
                aiPlanningModel: 'qwen/qwen3.6-plus',
                aiPlanningModelFamily: 'qwen3.6',
                aiInsightModel: 'qwen/qwen3.6-plus',
                aiInsightModelFamily: 'qwen3.6',
                aiTemperature: 0.2,
            }),
        });
        const data = mocks.prisma.team.update.mock.calls[0]?.[0]?.data as Record<string, unknown> | undefined;
        expect(data).toBeDefined();
        expect(data).not.toHaveProperty('openRouterKeyEncrypted');
    });

    it('stores null model family fields when provider config omits them', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                providerConfig: {
                    provider: 'openrouter',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    mainModel: 'qwen/qwen3.6-plus',
                    planningModel: 'qwen/qwen3.6-plus',
                    insightModel: 'qwen/qwen3.6-plus',
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
                aiMainModelFamily: null,
                aiPlanningModelFamily: null,
                aiInsightModelFamily: null,
            }),
        });
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
                    temperature: 'Temperature must be between 0 and 2',
                },
            },
        });
    });

    it('rejects temperature above upper bound', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                providerConfig: {
                    provider: 'openrouter',
                    temperature: 2.1,
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
                    temperature: 'Temperature must be between 0 and 2',
                },
            },
        });
    });

    it('rejects unsupported model family values', async () => {
        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                providerConfig: {
                    provider: 'openrouter',
                    mainModelFamily: 'claude',
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
                    mainModelFamily: expect.stringContaining('Invalid model family. Supported:'),
                },
            },
        });
    });

    it('rejects base url that resolves to blocked private network hosts', async () => {
        mocks.validateRuntimeRequestUrl.mockResolvedValueOnce({
            valid: false,
            error: 'Private network addresses are not allowed',
        });

        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                providerConfig: {
                    provider: 'openrouter',
                    baseUrl: 'http://169.254.169.254/latest/meta-data',
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
                    baseUrl: 'Private network addresses are not allowed',
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

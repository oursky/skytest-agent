import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isRateLimited: vi.fn(),
    getRateLimitKey: vi.fn(),
    getAuthgearRuntimeConfig: vi.fn(),
}));

vi.mock('@/lib/runners/rate-limit', () => ({
    isRateLimited: mocks.isRateLimited,
    getRateLimitKey: mocks.getRateLimitKey,
}));

vi.mock('@/lib/security/authgear-config', () => ({
    getAuthgearRuntimeConfig: mocks.getAuthgearRuntimeConfig,
}));

const { GET } = await import('@/app/api/authgear-proxy/route');

describe('GET /api/authgear-proxy', () => {
    beforeEach(() => {
        mocks.isRateLimited.mockReset();
        mocks.getRateLimitKey.mockReset();
        mocks.getAuthgearRuntimeConfig.mockReset();

        mocks.isRateLimited.mockResolvedValue(false);
        mocks.getRateLimitKey.mockReturnValue('authgear-proxy:test');
        mocks.getAuthgearRuntimeConfig.mockReturnValue({
            endpoint: 'http://localhost:3301',
            clientId: 'local-dev-client',
            redirectUri: 'http://localhost:3000/auth-redirect',
        });
    });

    it('returns upstream payload for allowed origin without redirecting', async () => {
        const upstreamSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ issuer: 'http://localhost:3301' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })
            );

        const response = await GET(
            new Request(
                'http://localhost:3000/api/authgear-proxy?url=http://localhost:3301/.well-known/openid-configuration'
            )
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('location')).toBeNull();
        await expect(response.json()).resolves.toEqual({ issuer: 'http://localhost:3301' });
        expect(upstreamSpy).toHaveBeenCalledWith(
            'http://localhost:3301/.well-known/openid-configuration',
            expect.objectContaining({ method: 'GET', redirect: 'manual' })
        );

        upstreamSpy.mockRestore();
    });

    it('does not forward x-forwarded headers to authgear upstream', async () => {
        const upstreamSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })
            );

        const response = await GET(
            new Request(
                'http://localhost:3000/api/authgear-proxy?url=http://localhost:3301/oauth2/userinfo',
                {
                    headers: {
                        'x-forwarded-host': 'localhost:3000',
                        'x-forwarded-proto': 'http',
                        'x-forwarded-port': '3000',
                        forwarded: 'host=localhost:3000;proto=http',
                    },
                }
            )
        );

        expect(response.status).toBe(200);

        const fetchInit = upstreamSpy.mock.calls[0]?.[1] as RequestInit;
        const forwardedHeaders = new Headers(fetchInit.headers);

        expect(forwardedHeaders.get('x-forwarded-host')).toBeNull();
        expect(forwardedHeaders.get('x-forwarded-proto')).toBeNull();
        expect(forwardedHeaders.get('x-forwarded-port')).toBeNull();
        expect(forwardedHeaders.get('forwarded')).toBeNull();

        upstreamSpy.mockRestore();
    });
});

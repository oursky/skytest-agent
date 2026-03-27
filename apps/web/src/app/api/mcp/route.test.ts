import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    isApiKeyFormat: vi.fn(),
    createMcpServer: vi.fn(),
    connect: vi.fn(),
    handleRequest: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/api-key', () => ({
    isApiKeyFormat: mocks.isApiKeyFormat,
}));

vi.mock('@/lib/mcp/server', () => ({
    createMcpServer: mocks.createMcpServer,
}));

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
    WebStandardStreamableHTTPServerTransport: class {
        async handleRequest(request: Request, auth: unknown) {
            return mocks.handleRequest(request, auth);
        }
    },
}));

const { GET } = await import('@/app/api/mcp/route');

describe('MCP route authentication', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.isApiKeyFormat.mockReset();
        mocks.createMcpServer.mockReset();
        mocks.connect.mockReset();
        mocks.handleRequest.mockReset();

        mocks.createMcpServer.mockReturnValue({
            connect: mocks.connect,
        });
        mocks.connect.mockResolvedValue(undefined);
        mocks.handleRequest.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    it('rejects unauthenticated MCP requests', async () => {
        const request = new Request('http://localhost/api/mcp', { method: 'GET' });

        const response = await GET(request);
        const payload = await response.json();

        expect(response.status).toBe(401);
        expect(payload).toMatchObject({ error: 'Unauthorized' });
        expect(mocks.handleRequest).not.toHaveBeenCalled();
    });

    it('forwards authenticated MCP requests with authInfo', async () => {
        mocks.isApiKeyFormat.mockReturnValue(true);
        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');

        const request = new Request('http://localhost/api/mcp', {
            method: 'GET',
            headers: {
                Authorization: 'Bearer sktest_api_key_123',
            },
        });

        const response = await GET(request);

        expect(response.status).toBe(200);
        expect(mocks.handleRequest).toHaveBeenCalledWith(
            request,
            {
                authInfo: {
                    token: 'api-key',
                    clientId: 'user-1',
                    scopes: [],
                },
            }
        );
    });

    it('accepts lowercase bearer scheme in Authorization header', async () => {
        mocks.isApiKeyFormat.mockReturnValue(true);
        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-2');

        const request = new Request('http://localhost/api/mcp', {
            method: 'GET',
            headers: {
                Authorization: 'bearer sk_test_lowercase_scheme',
            },
        });

        const response = await GET(request);

        expect(response.status).toBe(200);
        expect(mocks.handleRequest).toHaveBeenCalledWith(
            request,
            {
                authInfo: {
                    token: 'api-key',
                    clientId: 'user-2',
                    scopes: [],
                },
            }
        );
    });

    it('accepts X-SkyTest-Api-Key header', async () => {
        mocks.isApiKeyFormat.mockReturnValue(true);
        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-3');

        const request = new Request('http://localhost/api/mcp', {
            method: 'GET',
            headers: {
                'X-SkyTest-Api-Key': 'sk_test_header_key',
            },
        });

        const response = await GET(request);

        expect(response.status).toBe(200);
        expect(mocks.handleRequest).toHaveBeenCalledWith(
            request,
            {
                authInfo: {
                    token: 'api-key',
                    clientId: 'user-3',
                    scopes: [],
                },
            }
        );
    });
});

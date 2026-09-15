import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';

const ISSUER = 'https://issuer.test.example';
const RESOURCE_URI = 'https://skytest.test.example/api/mcp';
const METADATA_URL = 'https://skytest.test.example/.well-known/oauth-protected-resource/api/mcp';
const JWKS_URI = `${ISSUER}/oauth2/jwks`;

const mocks = vi.hoisted(() => ({
    userFindUnique: vi.fn(),
    createMcpServer: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    handleRequest: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        user: { findUnique: mocks.userFindUnique },
    },
}));

vi.mock('@/lib/mcp/server', () => ({
    createMcpServer: mocks.createMcpServer,
}));

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
    WebStandardStreamableHTTPServerTransport: class {
        async handleRequest(request: Request, options: unknown) {
            return mocks.handleRequest(request, options);
        }
    },
}));

const { GET, POST, DELETE } = await import('@/app/api/mcp/route');
const { __resetMcpOauthCachesForTests } = await import('@/lib/mcp/oauth-auth');

let privateKey: CryptoKey;
let publicJwk: JWK;
let otherPrivateKey: CryptoKey;

interface TokenOptions {
    subject?: string;
    audience?: string | string[];
    scope?: string;
    clientId?: string | null;
    issuer?: string;
    expiresIn?: number;
    notBefore?: number;
    signingKey?: CryptoKey;
    omitExpiry?: boolean;
}

async function createToken(options: TokenOptions = {}): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
        scope: options.scope ?? 'openid read:tools write:tools execute:tools offline_access',
    };
    if (options.clientId !== null) {
        payload.client_id = options.clientId ?? 'dcrc_testclient';
    }

    let builder = new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(options.issuer ?? ISSUER)
        .setAudience(options.audience ?? RESOURCE_URI)
        .setSubject(options.subject ?? 'auth-subject-1')
        .setIssuedAt(nowSeconds);

    if (!options.omitExpiry) {
        builder = builder.setExpirationTime(nowSeconds + (options.expiresIn ?? 600));
    }
    if (options.notBefore !== undefined) {
        builder = builder.setNotBefore(options.notBefore);
    }

    return builder.sign(options.signingKey ?? privateKey);
}

function mcpRequest(init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...init.headers };
    if (init.token) {
        headers.Authorization = `Bearer ${init.token}`;
    }
    const method = init.method ?? 'POST';
    return new Request(RESOURCE_URI, {
        method,
        headers,
        body: method === 'POST' && init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
}

function toolCall(name: string, args: Record<string, unknown> = {}) {
    return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
}

beforeEach(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = 'test-key';
    publicJwk.alg = 'RS256';
    otherPrivateKey = (await generateKeyPair('RS256')).privateKey;

    process.env.AUTHGEAR_ENDPOINT = ISSUER;
    process.env.MCP_RESOURCE_URI = RESOURCE_URI;

    __resetMcpOauthCachesForTests();
    mocks.userFindUnique.mockReset();
    mocks.createMcpServer.mockReset();
    mocks.connect.mockReset();
    mocks.close.mockReset();
    mocks.handleRequest.mockReset();

    mocks.userFindUnique.mockResolvedValue({ id: 'user-1' });
    mocks.createMcpServer.mockReturnValue({ connect: mocks.connect, close: mocks.close });
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.handleRequest.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === `${ISSUER}/.well-known/openid-configuration`) {
            return new Response(JSON.stringify({ issuer: ISSUER, jwks_uri: JWKS_URI }), { status: 200 });
        }
        if (url === JWKS_URI) {
            return new Response(JSON.stringify({ keys: [publicJwk] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response('not found', { status: 404 });
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('MCP route OAuth authentication', () => {
    it('challenges unauthenticated requests with resource metadata', async () => {
        const response = await GET(mcpRequest({ method: 'GET' }));

        expect(response.status).toBe(401);
        expect(response.headers.get('WWW-Authenticate')).toBe(
            `Bearer resource_metadata="${METADATA_URL}"`
        );
        expect(mocks.handleRequest).not.toHaveBeenCalled();
    });

    it('accepts a valid resource-bound token and forwards identity separately from client id', async () => {
        const token = await createToken({ subject: 'auth-subject-1' });

        const response = await POST(mcpRequest({ token, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }));

        expect(response.status).toBe(200);
        expect(mocks.userFindUnique).toHaveBeenCalledWith({
            where: { authId: 'auth-subject-1' },
            select: { id: true },
        });

        const [, options] = mocks.handleRequest.mock.calls[0];
        expect(options.authInfo.clientId).toBe('dcrc_testclient');
        expect(options.authInfo.extra).toEqual({ skytestUserId: 'user-1' });
        expect(options.authInfo.scopes).toContain('read:tools');
    });

    it('preserves the request body for the transport', async () => {
        const token = await createToken();
        const body = { jsonrpc: '2.0', id: 7, method: 'tools/list' };

        await POST(mcpRequest({ token, body }));

        const [forwardedRequest] = mocks.handleRequest.mock.calls[0];
        await expect(forwardedRequest.json()).resolves.toEqual(body);
    });

    it('closes the server after handling a request', async () => {
        const token = await createToken();

        await POST(mcpRequest({ token, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }));

        expect(mocks.close).toHaveBeenCalled();
    });

    it('answers an authenticated GET with 405 rather than a stream it cannot serve', async () => {
        const token = await createToken();

        const response = await GET(mcpRequest({ method: 'GET', token }));

        expect(response.status).toBe(405);
        expect(response.headers.get('Allow')).toBe('POST, DELETE');
        expect(mocks.createMcpServer).not.toHaveBeenCalled();
        expect(mocks.handleRequest).not.toHaveBeenCalled();
    });

    it.each([
        ['GET', GET],
        ['POST', POST],
        ['DELETE', DELETE],
    ] as const)('authenticates %s before dispatch', async (method, handler) => {
        const response = await handler(mcpRequest({ method }));

        expect(response.status).toBe(401);
        expect(mocks.handleRequest).not.toHaveBeenCalled();
    });
});

describe('MCP route token validation', () => {
    it('rejects a token signed by an unknown key', async () => {
        const token = await createToken({ signingKey: otherPrivateKey });

        const response = await POST(mcpRequest({ token }));

        expect(response.status).toBe(401);
        expect(response.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
    });

    it('rejects an expired token', async () => {
        const token = await createToken({ expiresIn: -60 });

        const response = await POST(mcpRequest({ token }));

        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ error: 'invalid_token' });
    });

    it('rejects a token without an expiry', async () => {
        const token = await createToken({ omitExpiry: true });

        expect((await POST(mcpRequest({ token }))).status).toBe(401);
    });

    it('rejects a token from another issuer', async () => {
        const token = await createToken({ issuer: 'https://evil.test.example' });

        expect((await POST(mcpRequest({ token }))).status).toBe(401);
    });

    it('rejects a token issued for a different resource', async () => {
        const token = await createToken({ audience: 'https://other.test.example/api/mcp' });

        const response = await POST(mcpRequest({ token }));

        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
            error_description: 'token audience does not match this resource',
        });
    });

    it('accepts the trailing-slash audience form Authgear may issue', async () => {
        const token = await createToken({ audience: `${RESOURCE_URI}/` });

        expect((await POST(mcpRequest({ token }))).status).toBe(200);
    });

    it('accepts the claim shape Authgear actually issues', async () => {
        const token = await createToken({
            audience: [RESOURCE_URI],
            scope: 'openid offline_access read:tools write:tools execute:tools',
        });

        expect((await POST(mcpRequest({ token, body: toolCall('list_projects') }))).status).toBe(200);
    });

    it('accepts an audience array containing the resource', async () => {
        const token = await createToken({ audience: ['https://other.test.example', RESOURCE_URI] });

        expect((await POST(mcpRequest({ token }))).status).toBe(200);
    });

    it('rejects a token with no client_id claim', async () => {
        const token = await createToken({ clientId: null });

        const response = await POST(mcpRequest({ token }));

        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
            error_description: 'token has no client_id claim',
        });
    });

    it('rejects a token that is not yet valid', async () => {
        const token = await createToken({ notBefore: Math.floor(Date.now() / 1000) + 600 });

        expect((await POST(mcpRequest({ token }))).status).toBe(401);
    });

    it('does not let unverified header content reach the challenge', async () => {
        const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const hostile = `${encode({ alg: 'RS256', crit: ['a\r\nX-Injected: 1'] })}.${encode({ sub: 'x' })}.AAAA`;

        const response = await POST(mcpRequest({ token: hostile }));

        expect(response.status).toBe(401);
        const challenge = response.headers.get('WWW-Authenticate') ?? '';
        expect(challenge).toContain('error="invalid_token"');
        expect(challenge).not.toContain('X-Injected');
        expect(challenge).not.toMatch(/[\r\n]/);
        expect(JSON.stringify(await response.json())).not.toContain('X-Injected');
    });

    it('reports a server error rather than a credential error when discovery fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
        const token = await createToken();

        const response = await POST(mcpRequest({ token }));

        expect(response.status).toBe(500);
        expect(response.headers.get('WWW-Authenticate')).toBeNull();
    });

    it('rejects every token when the resource URI is not configured', async () => {
        delete process.env.MCP_RESOURCE_URI;
        const token = await createToken();

        const response = await POST(mcpRequest({ token }));

        expect(response.status).toBe(500);
    });
});

describe('MCP route user resolution', () => {
    it('denies a verified subject with no SkyTest account', async () => {
        mocks.userFindUnique.mockResolvedValue(null);
        const token = await createToken();

        const response = await POST(mcpRequest({ token }));

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: 'access_denied' });
        expect(mocks.handleRequest).not.toHaveBeenCalled();
    });

    it('resolves the same account for different OAuth clients with one subject', async () => {
        const first = await createToken({ clientId: 'dcrc_clientA' });
        const second = await createToken({ clientId: 'dcrc_clientB' });

        await POST(mcpRequest({ token: first, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }));
        await POST(mcpRequest({ token: second, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } }));

        const [[, firstOptions], [, secondOptions]] = mocks.handleRequest.mock.calls;
        expect(firstOptions.authInfo.extra.skytestUserId).toBe('user-1');
        expect(secondOptions.authInfo.extra.skytestUserId).toBe('user-1');
        expect(firstOptions.authInfo.clientId).not.toBe(secondOptions.authInfo.clientId);
    });
});

describe('MCP route scope enforcement', () => {
    it('allows a read tool with read-only consent', async () => {
        const token = await createToken({ scope: 'openid read:tools offline_access' });

        const response = await POST(mcpRequest({ token, body: toolCall('list_projects') }));

        expect(response.status).toBe(200);
    });

    it('rejects protocol requests without the read baseline', async () => {
        const token = await createToken({ scope: 'openid offline_access' });

        const response = await POST(mcpRequest({ token, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }));

        expect(response.status).toBe(403);
        expect(response.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"');
    });

    it('returns an HTTP 403 challenge, not a wrapped tool result, for a missing write scope', async () => {
        const token = await createToken({ scope: 'read:tools' });

        const response = await POST(mcpRequest({ token, body: toolCall('create_test_case') }));

        expect(response.status).toBe(403);
        expect(response.headers.get('WWW-Authenticate')).toContain('scope="read:tools write:tools"');
        expect(await response.json()).toMatchObject({
            error: 'insufficient_scope',
            missing_scopes: ['write:tools'],
        });
        expect(mocks.handleRequest).not.toHaveBeenCalled();
    });

    it('rejects execution tools without execute consent', async () => {
        const token = await createToken({ scope: 'read:tools write:tools' });

        const response = await POST(mcpRequest({ token, body: toolCall('run_test_case', { testCaseId: 'tc-1' }) }));

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ missing_scopes: ['execute:tools'] });
    });

    it('requires execute consent for update_test_case with cancel_and_save', async () => {
        const token = await createToken({ scope: 'read:tools write:tools' });

        const response = await POST(mcpRequest({
            token,
            body: toolCall('update_test_case', { testCaseId: 'tc-1', activeRunResolution: 'cancel_and_save' }),
        }));

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ missing_scopes: ['execute:tools'] });
        expect(mocks.handleRequest).not.toHaveBeenCalled();
    });

    it('allows update_test_case with write consent when it does not cancel runs', async () => {
        const token = await createToken({ scope: 'read:tools write:tools' });

        const response = await POST(mcpRequest({
            token,
            body: toolCall('update_test_case', { testCaseId: 'tc-1', name: 'renamed' }),
        }));

        expect(response.status).toBe(200);
    });

    it('ignores scopes it does not define', async () => {
        const token = await createToken({ scope: 'openid offline_access read:tools profile' });

        expect((await POST(mcpRequest({ token, body: toolCall('list_projects') }))).status).toBe(200);
    });

    it('applies the strictest scope across a batched request', async () => {
        const token = await createToken({ scope: 'read:tools' });

        const response = await POST(mcpRequest({
            token,
            body: [toolCall('list_projects'), toolCall('delete_test_case', { testCaseId: 'tc-1' })],
        }));

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ missing_scopes: ['write:tools'] });
    });

    it('leaves unknown tool names to the SDK instead of a scope challenge', async () => {
        const token = await createToken({ scope: 'read:tools' });

        const response = await POST(mcpRequest({ token, body: toolCall('no_such_tool') }));

        expect(response.status).toBe(200);
        expect(mocks.handleRequest).toHaveBeenCalled();
    });

    it('leaves malformed JSON-RPC bodies to the SDK', async () => {
        const token = await createToken({ scope: 'read:tools' });
        const request = new Request(RESOURCE_URI, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: '{ not json',
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mocks.handleRequest).toHaveBeenCalled();
    });
});

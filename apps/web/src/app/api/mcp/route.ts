import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp/server';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { isApiKeyFormat } from '@/lib/security/api-key';
import { createLogger } from '@/lib/core/logger';

const logger = createLogger('api:mcp');
const SLOW_MCP_REQUEST_THRESHOLD_MS = 2_000;

export const dynamic = 'force-dynamic';

function getBearerToken(request: Request): string | null {
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
        const [scheme, ...parts] = authHeader.trim().split(/\s+/);
        if (scheme?.toLowerCase() === 'bearer' && parts.length > 0) {
            return parts.join(' ');
        }
    }

    const apiKeyHeader = request.headers.get('X-SkyTest-Api-Key')?.trim();
    if (apiKeyHeader) {
        return apiKeyHeader;
    }

    return null;
}

async function resolveAuthenticatedUserId(request: Request): Promise<string | null> {
    const token = getBearerToken(request);
    if (!token || !isApiKeyFormat(token)) {
        return null;
    }

    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return null;
    }

    return resolveUserId(authPayload);
}

async function handleMcpRequest(request: Request): Promise<Response> {
    const startedAtMs = Date.now();
    let authResolvedAtMs = startedAtMs;
    let serverConnectedAtMs = startedAtMs;
    try {
        const userId = await resolveAuthenticatedUserId(request);
        authResolvedAtMs = Date.now();
        if (!userId) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const server = createMcpServer();
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        await server.connect(transport);
        serverConnectedAtMs = Date.now();
        const response = await transport.handleRequest(request, {
            authInfo: { token: 'api-key', clientId: userId, scopes: [] },
        });
        const completedAtMs = Date.now();
        const authLatencyMs = authResolvedAtMs - startedAtMs;
        const setupLatencyMs = serverConnectedAtMs - authResolvedAtMs;
        const handleLatencyMs = completedAtMs - serverConnectedAtMs;
        const totalLatencyMs = completedAtMs - startedAtMs;
        if (totalLatencyMs >= SLOW_MCP_REQUEST_THRESHOLD_MS) {
            logger.warn('Slow MCP request', {
                method: request.method,
                authLatencyMs,
                setupLatencyMs,
                handleLatencyMs,
                totalLatencyMs,
            });
        } else {
            logger.debug('MCP request handled', {
                method: request.method,
                authLatencyMs,
                setupLatencyMs,
                handleLatencyMs,
                totalLatencyMs,
            });
        }
        return response;
    } catch (error) {
        logger.error('MCP request failed', error);
        return new Response(JSON.stringify({ error: 'MCP request failed' }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function GET(request: Request) { return handleMcpRequest(request); }
export async function POST(request: Request) { return handleMcpRequest(request); }
export async function DELETE(request: Request) { return handleMcpRequest(request); }

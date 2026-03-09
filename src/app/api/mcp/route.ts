import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp/server';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { isApiKeyFormat } from '@/lib/security/api-key';
import { createLogger } from '@/lib/core/logger';

const logger = createLogger('api:mcp');

export const dynamic = 'force-dynamic';

function getBearerToken(request: Request): string | null {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    return authHeader.split(' ')[1] ?? null;
}

function authRejectedResponse(description: string): Response {
    return new Response(JSON.stringify({ error: 'Forbidden', message: description }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleMcpRequest(request: Request): Promise<Response> {
    const token = getBearerToken(request);
    if (!token || !isApiKeyFormat(token)) {
        return authRejectedResponse('MCP requires an Agent API key token');
    }

    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return authRejectedResponse('Missing or invalid access token');
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return authRejectedResponse('Access token does not map to a valid user');
    }

    try {
        const server = createMcpServer();
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        await server.connect(transport);
        const response = await transport.handleRequest(request, {
            authInfo: { token: 'api-key', clientId: userId, scopes: [] }
        });
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

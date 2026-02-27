import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp-server';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { isApiKeyFormat } from '@/lib/api-key';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:mcp');

export const dynamic = 'force-dynamic';

function getBearerToken(request: Request): string | null {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    return authHeader.split(' ')[1] ?? null;
}

function unauthorizedResponse(description: string): Response {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer error="invalid_token", error_description="${description}"` }
    });
}

async function handleMcpRequest(request: Request): Promise<Response> {
    const token = getBearerToken(request);
    if (!token || !isApiKeyFormat(token)) {
        return unauthorizedResponse('MCP requires an Agent API key token');
    }

    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return unauthorizedResponse('Missing or invalid access token');
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return unauthorizedResponse('Access token does not map to a valid user');
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

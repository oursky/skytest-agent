import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp-server';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:mcp');

export const dynamic = 'force-dynamic';

async function handleMcpRequest(request: Request): Promise<Response> {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        });
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

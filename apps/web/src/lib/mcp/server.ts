import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpTools } from '@/lib/mcp/server-registry';

export function createMcpServer(): McpServer {
    const server = new McpServer(
        { name: 'skytest-agent', version: '1.0.0' },
        { capabilities: { tools: {} } }
    );

    registerMcpTools(server);
    return server;
}

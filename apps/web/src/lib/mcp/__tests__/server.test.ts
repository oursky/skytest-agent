import { describe, expect, it } from 'vitest';

import { createMcpServer } from '@/lib/mcp/server';

describe('createMcpServer', () => {
    it('creates the MCP server instance', () => {
        const server = createMcpServer();
        expect(server).toBeDefined();
    });
});

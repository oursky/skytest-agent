import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { createMcpServer } from '@/lib/mcp/server';

type RegisterToolArgs = [
    name: string,
    config: { description?: string; inputSchema?: Record<string, unknown> },
    handler: (...args: unknown[]) => unknown,
];

describe('mcp manifest compatibility', () => {
    it('keeps tool registration names and input schema keys stable', () => {
        const manifest: Array<{
            name: string;
            description: string;
            inputKeys: string[];
        }> = [];

        const registerToolSpy = vi.spyOn(
            McpServer.prototype as unknown as { registerTool: (...args: RegisterToolArgs) => McpServer },
            'registerTool'
        ).mockImplementation(function registerToolMock(this: McpServer, name, config) {
            manifest.push({
                name,
                description: config.description ?? '',
                inputKeys: Object.keys(config.inputSchema ?? {}).sort(),
            });
            return this;
        });

        try {
            createMcpServer();
        } finally {
            registerToolSpy.mockRestore();
        }

        expect(manifest).toMatchSnapshot();
    });
});

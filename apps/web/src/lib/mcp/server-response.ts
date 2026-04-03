import { createLogger } from '@/lib/core/logger';

const mcpToolLogger = createLogger('mcp:tool');

export function textResult(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string, details?: unknown) {
    const payload = details === undefined
        ? { error: message }
        : { error: message, details };
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], isError: true as const };
}

export type ToolResponse = ReturnType<typeof textResult> | ReturnType<typeof errorResult>;

function calculateToolResponseBytes(result: ToolResponse): number {
    return result.content.reduce((sum, entry) => sum + entry.text.length, 0);
}

// Telemetry is intentionally applied to the highest-volume MCP tools first to
// keep overhead low while preserving hotspot visibility for performance work.
export async function withToolTelemetry(
    toolName: string,
    handler: () => Promise<ToolResponse>
): Promise<ToolResponse> {
    const startedAtMs = Date.now();
    try {
        const result = await handler();
        mcpToolLogger.debug('MCP tool handled', {
            toolName,
            elapsedMs: Date.now() - startedAtMs,
            responseBytes: calculateToolResponseBytes(result),
            isError: 'isError' in result && result.isError === true,
        });
        return result;
    } catch (error) {
        mcpToolLogger.warn('MCP tool failed', {
            toolName,
            elapsedMs: Date.now() - startedAtMs,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}

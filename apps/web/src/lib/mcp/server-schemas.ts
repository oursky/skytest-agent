import { z } from 'zod';

export const mcpStepSchema = z.object({
    id: z.string().describe('Step ID (e.g. "step_1")'),
    target: z.string().describe('Target ID (e.g. "browser_a")'),
    action: z.string().describe('Natural language action or verification'),
    type: z.enum(['ai-action', 'playwright-code']).optional().describe('Step type, default ai-action'),
});

export const mcpConfigSchema = z.object({
    name: z.string().describe('Variable/config name (UPPER_SNAKE_CASE)'),
    type: z.string().describe('URL | VARIABLE | RANDOM_STRING | APP_ID'),
    value: z.string().optional().describe('Config value. RANDOM_STRING requires TIMESTAMP_DATETIME, TIMESTAMP_UNIX, or UUID'),
    masked: z.boolean().optional().describe('Mask value in UI (VARIABLE type only)'),
    group: z.string().nullable().optional().describe('Group name for team'),
});

export const mcpRunOverridesSchema = z.object({
    url: z.string().optional().describe('Override URL for this run'),
    prompt: z.string().optional().describe('Override prompt for this run'),
    steps: z.array(mcpStepSchema).optional().describe('Override steps for this run'),
    browserConfig: z.record(z.string(), z.unknown()).optional().describe('Override browser/android target config for this run'),
    requestedDeviceId: z.string().optional().describe('Optional explicit requested device id for Android runs'),
    requestedRunnerId: z.string().optional().describe('Optional explicit requested runner id for Android runs'),
});

export type McpRunOverridesInput = z.infer<typeof mcpRunOverridesSchema>;

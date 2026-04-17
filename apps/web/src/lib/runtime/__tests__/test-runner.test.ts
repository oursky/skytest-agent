import { describe, expect, it, vi } from 'vitest';

import { TEST_STATUS } from '@/types';
import { runTest } from '@/lib/runtime/test-runner';

describe('runTest', () => {
    it('fails fast when AI provider key is missing', async () => {
        const result = await runTest({
            config: {
                openRouterApiKey: '',
            },
            onEvent: vi.fn(),
            runId: 'test-run-id',
        } as never);

        expect(result.status).toBe(TEST_STATUS.FAIL);
        expect(result.error).toContain('AI provider key is required');
        expect(result.errorCode).toBe('CONFIGURATION_ERROR');
    });

    it('classifies malformed AI keys with AI_KEY_INVALID_FORMAT', async () => {
        const result = await runTest({
            config: {
                url: 'https://example.com',
                prompt: 'Open the page',
                openRouterApiKey: 'bad✅key123',
            },
            onEvent: vi.fn(),
            runId: 'test-run-id',
        } as never);

        expect(result.status).toBe(TEST_STATUS.FAIL);
        expect(result.errorCode).toBe('AI_KEY_INVALID_FORMAT');
        expect(result.errorCategory).toBe('CONFIGURATION');
    });
});

import { afterEach, describe, expect, it } from 'vitest';

import { buildMidsceneModelConfig } from '@/lib/runtime/midscene-env';

const ORIGINAL_ENV = { ...process.env };

describe('buildMidsceneModelConfig', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it('builds a model config map without mutating process.env', () => {
        process.env.SKYTEST_MIDSCENE_MODEL_NAME = 'custom/default-model';
        process.env.SKYTEST_MIDSCENE_PLANNING_MODEL_NAME = 'custom/planning-model';

        const before = process.env.MIDSCENE_MODEL_API_KEY;
        const modelConfig = buildMidsceneModelConfig('test-api-key');

        expect(modelConfig.MIDSCENE_MODEL_API_KEY).toBe('test-api-key');
        expect(modelConfig.MIDSCENE_MODEL_NAME).toBe('custom/default-model');
        expect(modelConfig.MIDSCENE_PLANNING_MODEL_NAME).toBe('custom/planning-model');
        expect(process.env.MIDSCENE_MODEL_API_KEY).toBe(before);
    });

    it('throws when api key is empty', () => {
        expect(() => buildMidsceneModelConfig('')).toThrow('API key is required');
    });
});

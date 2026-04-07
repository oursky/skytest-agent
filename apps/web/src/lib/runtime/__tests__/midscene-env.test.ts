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

    it('applies baseUrl option to all model configs', () => {
        const config = buildMidsceneModelConfig('test-key', { baseUrl: 'https://custom.ai/v1' });

        expect(config.MIDSCENE_MODEL_BASE_URL).toBe('https://custom.ai/v1');
        expect(config.MIDSCENE_PLANNING_MODEL_BASE_URL).toBe('https://custom.ai/v1');
        expect(config.MIDSCENE_INSIGHT_MODEL_BASE_URL).toBe('https://custom.ai/v1');
    });

    it('applies mainModel option', () => {
        const config = buildMidsceneModelConfig('test-key', { mainModel: 'anthropic/claude-3' });

        expect(config.MIDSCENE_MODEL_NAME).toBe('anthropic/claude-3');
        expect(config.MIDSCENE_MODEL_FAMILY).toBe('gpt-5');
    });

    it('applies planningModel option', () => {
        const config = buildMidsceneModelConfig('test-key', { planningModel: 'openai/gpt-5' });

        expect(config.MIDSCENE_PLANNING_MODEL_NAME).toBe('openai/gpt-5');
        expect(config.MIDSCENE_PLANNING_MODEL_FAMILY).toBe('gpt-5');
    });

    it('applies insightModel option', () => {
        const config = buildMidsceneModelConfig('test-key', { insightModel: 'meta/llama-4' });

        expect(config.MIDSCENE_INSIGHT_MODEL_NAME).toBe('meta/llama-4');
        expect(config.MIDSCENE_INSIGHT_MODEL_FAMILY).toBe('gpt-5');
    });

    it('maps google model family to gemini', () => {
        const config = buildMidsceneModelConfig('test-key', { mainModel: 'google/gemini-2.0-flash-001' });

        expect(config.MIDSCENE_MODEL_FAMILY).toBe('gemini');
    });

    it('uses explicit model family options when provided', () => {
        const config = buildMidsceneModelConfig('test-key', {
            mainModel: 'google/gemini-2.0-flash-001',
            mainModelFamily: 'custom-main',
            planningModel: 'qwen/qwen3.5-27b',
            planningModelFamily: 'custom-plan',
            insightModel: 'qwen/qwen3.5-27b',
            insightModelFamily: 'custom-insight',
        });

        expect(config.MIDSCENE_MODEL_FAMILY).toBe('custom-main');
        expect(config.MIDSCENE_PLANNING_MODEL_FAMILY).toBe('custom-plan');
        expect(config.MIDSCENE_INSIGHT_MODEL_FAMILY).toBe('custom-insight');
    });

    it('applies temperature option as number', () => {
        const config = buildMidsceneModelConfig('test-key', { temperature: 0.9 });

        expect(config.MIDSCENE_MODEL_TEMPERATURE).toBe(0.9);
    });

    it('falls back to env defaults when options are not provided', () => {
        process.env.MIDSCENE_MODEL_BASE_URL = 'https://fallback.env/v1';
        process.env.MIDSCENE_MODEL_NAME = 'fallback/model';
        process.env.MIDSCENE_PLANNING_MODEL_NAME = 'fallback/planning';
        process.env.MIDSCENE_INSIGHT_MODEL_NAME = 'fallback/insight';
        process.env.MIDSCENE_MODEL_TEMPERATURE = '0.5';

        const config = buildMidsceneModelConfig('test-key');

        expect(config.MIDSCENE_MODEL_BASE_URL).toBe('https://fallback.env/v1');
        expect(config.MIDSCENE_MODEL_NAME).toBe('fallback/model');
        expect(config.MIDSCENE_PLANNING_MODEL_NAME).toBe('fallback/planning');
        expect(config.MIDSCENE_INSIGHT_MODEL_NAME).toBe('fallback/insight');
        expect(config.MIDSCENE_MODEL_TEMPERATURE).toBe(0.5);
    });
});

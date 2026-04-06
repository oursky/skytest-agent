import { describe, expect, it } from 'vitest';

import { buildTeamAiProviderConfig, resolveTeamMidsceneConfig } from '@/lib/runtime/team-ai-config';

describe('team-ai-config', () => {
    it('falls back to defaults when provider fields are unset', () => {
        const config = resolveTeamMidsceneConfig({
            aiProvider: null,
            aiBaseUrl: null,
            aiMainModel: null,
            aiPlanningModel: null,
            aiInsightModel: null,
            aiTemperature: null,
        });

        expect(config.baseUrl).toBeUndefined();
        expect(config.mainModel).toBeUndefined();
        expect(config.planningModel).toBeUndefined();
        expect(config.insightModel).toBeUndefined();
        expect(config.temperature).toBeUndefined();
    });

    it('uses openai-compatible team config when present', () => {
        const config = resolveTeamMidsceneConfig({
            aiProvider: 'openai-compatible',
            aiBaseUrl: 'https://api.openai.com/v1',
            aiMainModel: 'gpt-5.3-codex',
            aiPlanningModel: 'gpt-5.3-mini',
            aiInsightModel: 'gpt-5.3-mini',
            aiTemperature: 0.25,
        });

        expect(config.baseUrl).toBe('https://api.openai.com/v1');
        expect(config.mainModel).toBe('gpt-5.3-codex');
        expect(config.planningModel).toBe('gpt-5.3-mini');
        expect(config.insightModel).toBe('gpt-5.3-mini');
        expect(config.temperature).toBe(0.25);
    });

    it('normalizes unknown providers to openrouter', () => {
        const providerConfig = buildTeamAiProviderConfig({
            aiProvider: 'unknown-provider',
        });

        expect(providerConfig.provider).toBe('openrouter');
    });

    it('normalizes legacy compat providers to openrouter', () => {
        const providerConfig = buildTeamAiProviderConfig({
            aiProvider: 'CUSTOM_COMPAT',
        });

        expect(providerConfig.provider).toBe('openrouter');
    });
});

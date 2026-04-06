import type { BuildMidsceneModelConfigOptions } from '@/lib/runtime/midscene-env';

export type TeamAiProvider = 'openrouter' | 'openai-compatible';
export type TeamAiProviderDbValue =
    | 'OPENROUTER'
    | 'OPENAI'
    | 'XAI'
    | 'ANTHROPIC_COMPAT'
    | 'CUSTOM_COMPAT'
    | 'ACP_COMPAT';

export interface TeamAiProviderFields {
    aiProvider?: string | null;
    aiBaseUrl?: string | null;
    aiMainModel?: string | null;
    aiPlanningModel?: string | null;
    aiInsightModel?: string | null;
    aiTemperature?: number | null;
}

export interface TeamAiProviderConfig {
    provider: TeamAiProvider;
    baseUrl: string | null;
    mainModel: string | null;
    planningModel: string | null;
    insightModel: string | null;
    temperature: number | null;
}

export function toTeamAiProviderDbValue(provider: TeamAiProvider): TeamAiProviderDbValue {
    return provider === 'openai-compatible' ? 'OPENAI' : 'OPENROUTER';
}

export function fromTeamAiProviderDbValue(provider?: string | null): TeamAiProvider {
    return provider === 'OPENAI' || provider === 'openai-compatible' ? 'openai-compatible' : 'openrouter';
}

function normalizeProvider(provider?: string | null): TeamAiProvider {
    return fromTeamAiProviderDbValue(provider);
}

export function buildTeamAiProviderConfig(team: TeamAiProviderFields | null | undefined): TeamAiProviderConfig {
    const provider = normalizeProvider(team?.aiProvider);

    return {
        provider,
        baseUrl: team?.aiBaseUrl ?? null,
        mainModel: team?.aiMainModel ?? null,
        planningModel: team?.aiPlanningModel ?? null,
        insightModel: team?.aiInsightModel ?? null,
        temperature: team?.aiTemperature ?? null,
    };
}

export function resolveTeamMidsceneConfig(team: TeamAiProviderFields | null | undefined): BuildMidsceneModelConfigOptions {
    const providerConfig = buildTeamAiProviderConfig(team);

    return {
        baseUrl: providerConfig.baseUrl ?? undefined,
        mainModel: providerConfig.mainModel ?? undefined,
        planningModel: providerConfig.planningModel ?? undefined,
        insightModel: providerConfig.insightModel ?? undefined,
        temperature: providerConfig.temperature ?? undefined,
    };
}

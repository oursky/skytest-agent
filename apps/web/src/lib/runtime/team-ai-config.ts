import type { BuildMidsceneModelConfigOptions } from '@/lib/runtime/midscene-env';

export type TeamAiProvider = 'openrouter' | 'openai-compatible';
export type TeamAiProviderDbValue = 'OPENROUTER' | 'OPENAI';

export interface TeamAiProviderFields {
    aiProvider?: string | null;
    aiBaseUrl?: string | null;
    aiMainModel?: string | null;
    aiMainModelFamily?: string | null;
    aiPlanningModel?: string | null;
    aiPlanningModelFamily?: string | null;
    aiInsightModel?: string | null;
    aiInsightModelFamily?: string | null;
    aiTemperature?: number | null;
}

export interface TeamAiProviderConfig {
    provider: TeamAiProvider;
    baseUrl: string | null;
    mainModel: string | null;
    mainModelFamily: string | null;
    planningModel: string | null;
    planningModelFamily: string | null;
    insightModel: string | null;
    insightModelFamily: string | null;
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
        mainModelFamily: team?.aiMainModelFamily ?? null,
        planningModel: team?.aiPlanningModel ?? null,
        planningModelFamily: team?.aiPlanningModelFamily ?? null,
        insightModel: team?.aiInsightModel ?? null,
        insightModelFamily: team?.aiInsightModelFamily ?? null,
        temperature: team?.aiTemperature ?? null,
    };
}

export function resolveTeamMidsceneConfig(team: TeamAiProviderFields | null | undefined): BuildMidsceneModelConfigOptions {
    const providerConfig = buildTeamAiProviderConfig(team);

    return {
        baseUrl: providerConfig.baseUrl ?? undefined,
        mainModel: providerConfig.mainModel ?? undefined,
        mainModelFamily: providerConfig.mainModelFamily ?? undefined,
        planningModel: providerConfig.planningModel ?? undefined,
        planningModelFamily: providerConfig.planningModelFamily ?? undefined,
        insightModel: providerConfig.insightModel ?? undefined,
        insightModelFamily: providerConfig.insightModelFamily ?? undefined,
        temperature: providerConfig.temperature ?? undefined,
    };
}

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { encrypt, decrypt, maskApiKey } from '@/lib/security/crypto';
import { isTeamMember } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';
import {
    buildTeamAiProviderConfig,
    toTeamAiProviderDbValue,
    type TeamAiProvider,
    type TeamAiProviderConfig,
} from '@/lib/runtime/team-ai-config';

const logger = createLogger('api:teams:ai-key');

export const dynamic = 'force-dynamic';

interface ProviderConfigInput {
    provider?: TeamAiProvider;
    baseUrl?: string | null;
    mainModel?: string | null;
    mainModelFamily?: string | null;
    planningModel?: string | null;
    planningModelFamily?: string | null;
    insightModel?: string | null;
    insightModelFamily?: string | null;
    temperature?: number | null;
}

type ProviderConfigFieldErrors = Partial<Record<
    | 'apiKey'
    | 'baseUrl'
    | 'mainModel'
    | 'mainModelFamily'
    | 'planningModel'
    | 'planningModelFamily'
    | 'insightModel'
    | 'insightModelFamily'
    | 'temperature',
    string
>>;

function normalizeTextValue(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeProviderConfig(input: ProviderConfigInput | null | undefined): TeamAiProviderConfig {
    const provider = input?.provider === 'openai-compatible' ? 'openai-compatible' : 'openrouter';

    return {
        provider,
        baseUrl: normalizeTextValue(input?.baseUrl),
        mainModel: normalizeTextValue(input?.mainModel),
        mainModelFamily: normalizeTextValue(input?.mainModelFamily),
        planningModel: normalizeTextValue(input?.planningModel),
        planningModelFamily: normalizeTextValue(input?.planningModelFamily),
        insightModel: normalizeTextValue(input?.insightModel),
        insightModelFamily: normalizeTextValue(input?.insightModelFamily),
        temperature: typeof input?.temperature === 'number' && Number.isFinite(input.temperature)
            ? input.temperature
            : null,
    };
}

function validateProviderConfigInput(input: ProviderConfigInput | null | undefined): ProviderConfigFieldErrors {
    const fieldErrors: ProviderConfigFieldErrors = {};
    const normalized = normalizeProviderConfig(input);

    if (normalized.baseUrl) {
        try {
            const parsed = new URL(normalized.baseUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                fieldErrors.baseUrl = 'Base URL must use http or https';
            }
        } catch {
            fieldErrors.baseUrl = 'Base URL must be a valid URL';
        }
    }

    if (input && input.temperature !== undefined && input.temperature !== null) {
        if (
            typeof input.temperature !== 'number'
            || !Number.isFinite(input.temperature)
            || input.temperature < 0
        ) {
            fieldErrors.temperature = 'Temperature must be greater than or equal to 0';
        }
    }

    return fieldErrors;
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => isTeamMember(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { teamId: id } = guard;

        const team = await prisma.team.findUnique({
            where: { id },
            select: {
                openRouterKeyEncrypted: true,
                openRouterKeyUpdatedAt: true,
                aiProvider: true,
                aiBaseUrl: true,
                aiMainModel: true,
                aiMainModelFamily: true,
                aiPlanningModel: true,
                aiPlanningModelFamily: true,
                aiInsightModel: true,
                aiInsightModelFamily: true,
                aiTemperature: true,
            }
        });

        if (!team) {
            return NextResponse.json({
                hasKey: false,
                maskedKey: null,
                updatedAt: null,
                providerConfig: buildTeamAiProviderConfig(null),
            });
        }

        const providerConfig = buildTeamAiProviderConfig(team);

        if (!team.openRouterKeyEncrypted) {
            return NextResponse.json({ hasKey: false, maskedKey: null, updatedAt: null, providerConfig });
        }

        return NextResponse.json({
            hasKey: true,
            maskedKey: maskApiKey(decrypt(team.openRouterKeyEncrypted)),
            updatedAt: team.openRouterKeyUpdatedAt,
            providerConfig,
        });
    } catch (error) {
        logger.error('Failed to fetch team AI key', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to load team key' });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => isTeamMember(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { teamId: id } = guard;

        const { apiKey, providerConfig: providerConfigInput } = await request.json() as {
            apiKey?: string;
            providerConfig?: ProviderConfigInput;
        };

        const fieldErrors = validateProviderConfigInput(providerConfigInput);
        if (typeof apiKey === 'string' && !apiKey.trim()) {
            fieldErrors.apiKey = 'API key is required';
        }

        if (Object.keys(fieldErrors).length > 0) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Please fix the highlighted fields',
                details: { fieldErrors },
            });
        }

        const normalizedProviderConfig = normalizeProviderConfig(providerConfigInput);
        const apiKeyTrimmed = typeof apiKey === 'string' ? apiKey.trim() : null;
        const now = new Date();

        await prisma.team.update({
            where: { id },
            data: {
                ...(apiKeyTrimmed
                    ? {
                        openRouterKeyEncrypted: encrypt(apiKeyTrimmed),
                        openRouterKeyUpdatedAt: now,
                    }
                    : {}),
                aiProvider: toTeamAiProviderDbValue(normalizedProviderConfig.provider),
                aiBaseUrl: normalizedProviderConfig.baseUrl,
                aiMainModel: normalizedProviderConfig.mainModel,
                aiMainModelFamily: normalizedProviderConfig.mainModelFamily,
                aiPlanningModel: normalizedProviderConfig.planningModel,
                aiPlanningModelFamily: normalizedProviderConfig.planningModelFamily,
                aiInsightModel: normalizedProviderConfig.insightModel,
                aiInsightModelFamily: normalizedProviderConfig.insightModelFamily,
                aiTemperature: normalizedProviderConfig.temperature,
                aiConfigUpdatedAt: now,
            }
        });

        return NextResponse.json({
            success: true,
            maskedKey: apiKeyTrimmed ? maskApiKey(apiKeyTrimmed) : null,
            providerConfig: normalizedProviderConfig,
        });
    } catch (error) {
        logger.error('Failed to save team AI key', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to save team key' });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => isTeamMember(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { teamId: id } = guard;

        await prisma.team.update({
            where: { id },
            data: {
                openRouterKeyEncrypted: null,
                openRouterKeyUpdatedAt: null,
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to remove team AI key', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to remove team key' });
    }
}

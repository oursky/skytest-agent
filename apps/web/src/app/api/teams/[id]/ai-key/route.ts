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
import { validateMidsceneApiKey } from '@/lib/runtime/midscene-env';
import { VALID_MODEL_FAMILIES } from '@/lib/runtime/model-families';
import { validateRuntimeRequestUrl } from '@/lib/security/url-security-runtime';

const logger = createLogger('api:teams:ai-key');
const VALID_MODEL_FAMILY_SET = new Set<string>(VALID_MODEL_FAMILIES);
const SUPPORTED_MODEL_FAMILY_MESSAGE = `Invalid model family. Supported: ${VALID_MODEL_FAMILIES.join(', ')}`;
const MIN_API_KEY_LENGTH = 8;

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

async function validateProviderConfigInput(input: ProviderConfigInput | null | undefined): Promise<ProviderConfigFieldErrors> {
    const fieldErrors: ProviderConfigFieldErrors = {};
    const normalized = normalizeProviderConfig(input);

    if (normalized.baseUrl) {
        const validation = await validateRuntimeRequestUrl(normalized.baseUrl);
        if (!validation.valid) {
            fieldErrors.baseUrl = validation.error ?? 'Base URL is not allowed';
        }
    }

    if (input && input.temperature !== undefined && input.temperature !== null) {
        if (
            typeof input.temperature !== 'number'
            || !Number.isFinite(input.temperature)
            || input.temperature < 0
            || input.temperature > 2
        ) {
            fieldErrors.temperature = 'Temperature must be between 0 and 2';
        }
    }

    for (const [fieldKey, fieldValue] of [
        ['mainModelFamily', normalized.mainModelFamily],
        ['planningModelFamily', normalized.planningModelFamily],
        ['insightModelFamily', normalized.insightModelFamily],
    ] as const) {
        if (fieldValue && !VALID_MODEL_FAMILY_SET.has(fieldValue)) {
            fieldErrors[fieldKey] = SUPPORTED_MODEL_FAMILY_MESSAGE;
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

        const fieldErrors = await validateProviderConfigInput(providerConfigInput);
        const apiKeyTrimmed = typeof apiKey === 'string' ? apiKey.trim() : null;
        if (apiKeyTrimmed !== null && apiKeyTrimmed.length === 0) {
            fieldErrors.apiKey = 'API key is required';
        } else if (apiKeyTrimmed !== null && apiKeyTrimmed.length < MIN_API_KEY_LENGTH) {
            fieldErrors.apiKey = `API key must be at least ${MIN_API_KEY_LENGTH} characters`;
        } else if (apiKeyTrimmed !== null) {
            const apiKeyValidationError = validateMidsceneApiKey(apiKeyTrimmed);
            if (apiKeyValidationError) {
                fieldErrors.apiKey = apiKeyValidationError;
            }
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

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
    planningModel?: string | null;
    insightModel?: string | null;
    temperature?: number | null;
}

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
        planningModel: normalizeTextValue(input?.planningModel),
        insightModel: normalizeTextValue(input?.insightModel),
        temperature: typeof input?.temperature === 'number' && Number.isFinite(input.temperature)
            ? input.temperature
            : null,
    };
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
                aiPlanningModel: true,
                aiInsightModel: true,
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
        if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'API key is required' });
        }

        const normalizedProviderConfig = normalizeProviderConfig(providerConfigInput);

        await prisma.team.update({
            where: { id },
            data: {
                openRouterKeyEncrypted: encrypt(apiKey),
                openRouterKeyUpdatedAt: new Date(),
                aiProvider: toTeamAiProviderDbValue(normalizedProviderConfig.provider),
                aiBaseUrl: normalizedProviderConfig.baseUrl,
                aiMainModel: normalizedProviderConfig.mainModel,
                aiPlanningModel: normalizedProviderConfig.planningModel,
                aiInsightModel: normalizedProviderConfig.insightModel,
                aiTemperature: normalizedProviderConfig.temperature,
                aiConfigUpdatedAt: new Date(),
            }
        });

        return NextResponse.json({
            success: true,
            maskedKey: maskApiKey(apiKey),
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

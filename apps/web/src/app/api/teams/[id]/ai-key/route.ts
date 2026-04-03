import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { encrypt, decrypt, maskApiKey } from '@/lib/security/crypto';
import { isTeamMember } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';

const logger = createLogger('api:teams:ai-key');

export const dynamic = 'force-dynamic';

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
            }
        });

        if (!team || !team.openRouterKeyEncrypted) {
            return NextResponse.json({ hasKey: false, maskedKey: null, updatedAt: null });
        }

        return NextResponse.json({
            hasKey: true,
            maskedKey: maskApiKey(decrypt(team.openRouterKeyEncrypted)),
            updatedAt: team.openRouterKeyUpdatedAt,
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

        const { apiKey } = await request.json() as { apiKey?: string };
        if (!apiKey || typeof apiKey !== 'string') {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'API key is required' });
        }

        if (!apiKey.startsWith('sk-')) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Invalid API key format' });
        }

        await prisma.team.update({
            where: { id },
            data: {
                openRouterKeyEncrypted: encrypt(apiKey),
                openRouterKeyUpdatedAt: new Date(),
            }
        });

        return NextResponse.json({
            success: true,
            maskedKey: maskApiKey(apiKey),
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

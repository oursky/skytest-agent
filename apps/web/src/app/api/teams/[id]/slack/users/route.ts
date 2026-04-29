import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { apiError } from '@/lib/security/api-route-standards';
import { decrypt } from '@/lib/security/crypto';
import { isTeamMember } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';
import { getLookupCacheValue, setLookupCacheValue } from '@/lib/integrations/slack/lookup-cache';
import { listUsers, type SlackUsersPage } from '@/lib/integrations/slack/client';

const logger = createLogger('api:teams:slack-users');

function parseLimit(value: string | null): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed)) {
        return 100;
    }
    return Math.min(200, Math.max(1, parsed));
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
        const team = await prisma.team.findUnique({
            where: { id: guard.teamId },
            select: { slackBotTokenEncrypted: true },
        });
        if (!team?.slackBotTokenEncrypted) {
            return apiError({
                status: 409,
                code: 'CONFLICT',
                error: 'Slack token is not configured',
            });
        }

        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor')?.trim() || undefined;
        const query = url.searchParams.get('q')?.trim() || undefined;
        const limit = parseLimit(url.searchParams.get('limit'));
        const cacheKey = `users:${guard.teamId}:${cursor ?? ''}:${query ?? ''}:${limit}`;
        const cached = getLookupCacheValue<SlackUsersPage>(cacheKey);
        if (cached) {
            return NextResponse.json(cached);
        }

        const page = await listUsers({
            token: decrypt(team.slackBotTokenEncrypted),
            cursor,
            query,
            limit,
        });
        setLookupCacheValue(cacheKey, page);
        return NextResponse.json(page);
    } catch (error) {
        logger.warn('Failed to list Slack users', {
            error: error instanceof Error ? error.message : String(error),
        });
        return apiError({
            status: 502,
            code: 'INTERNAL_ERROR',
            error: 'Failed to list Slack users',
        });
    }
}

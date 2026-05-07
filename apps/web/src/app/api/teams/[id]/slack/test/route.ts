import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { apiError } from '@/lib/security/api-route-standards';
import { decrypt } from '@/lib/security/crypto';
import { isTeamMember } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';
import { authTest } from '@/lib/integrations/slack/client';
import {
    SlackAuthError,
    SlackRateLimitError,
    SlackTransientError,
} from '@/lib/integrations/slack/errors';

const logger = createLogger('api:teams:slack-test');

export const dynamic = 'force-dynamic';

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
        const body = await request.json().catch(() => ({})) as { token?: string };
        const providedToken = body.token?.trim() ?? '';

        let token = providedToken;
        if (!token) {
            const team = await prisma.team.findUnique({
                where: { id: guard.teamId },
                select: { slackBotTokenEncrypted: true },
            });

            if (!team?.slackBotTokenEncrypted) {
                return NextResponse.json({
                    error: 'TEAM_TOKEN_MISSING',
                }, { status: 409 });
            }
            token = decrypt(team.slackBotTokenEncrypted);
        }

        const auth = await authTest(token);
        return NextResponse.json({
            success: true,
            slackTeamName: auth.teamName,
            slackBotUserId: auth.botUserId,
        });
    } catch (error) {
        logger.warn('Slack connection test failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof SlackAuthError) {
            return NextResponse.json({
                error: 'TEAM_TOKEN_INVALID',
            }, { status: 409 });
        }
        if (error instanceof SlackRateLimitError || error instanceof SlackTransientError) {
            return NextResponse.json({
                error: 'SLACK_UPSTREAM',
            }, { status: 502 });
        }
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to test Slack connection',
        });
    }
}

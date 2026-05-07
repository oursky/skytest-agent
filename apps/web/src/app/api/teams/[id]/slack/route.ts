import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { apiError } from '@/lib/security/api-route-standards';
import { encrypt } from '@/lib/security/crypto';
import { isTeamMember } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';
import { authTest } from '@/lib/integrations/slack/client';
import {
    SlackAuthError,
    SlackRateLimitError,
    SlackTransientError,
} from '@/lib/integrations/slack/errors';
import type { TeamSlackSettings } from '@/types/slack';

const logger = createLogger('api:teams:slack');

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
        const team = await prisma.team.findUnique({
            where: { id: guard.teamId },
            select: {
                slackBotTokenEncrypted: true,
                slackTeamName: true,
                slackBotUserId: true,
                slackConfigUpdatedAt: true,
            },
        });

        const response: TeamSlackSettings = {
            hasToken: Boolean(team?.slackBotTokenEncrypted),
            slackTeamName: team?.slackTeamName ?? null,
            slackBotUserId: team?.slackBotUserId ?? null,
            slackConfigUpdatedAt: team?.slackConfigUpdatedAt?.toISOString() ?? null,
        };

        return NextResponse.json(response);
    } catch (error) {
        logger.error('Failed to load team Slack settings', error);
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to load Slack settings',
        });
    }
}

export async function PUT(
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

    let body: { token?: string };
    try {
        body = await request.json() as { token?: string };
    } catch {
        return NextResponse.json({
            error: 'INVALID_PAYLOAD',
        }, { status: 400 });
    }

    const token = body.token?.trim() ?? '';
    if (!token) {
        return NextResponse.json({
            error: 'TEAM_TOKEN_REQUIRED',
            field: 'token',
        }, { status: 400 });
    }

    try {
        const auth = await authTest(token);
        const now = new Date();
        await prisma.team.update({
            where: { id: guard.teamId },
            data: {
                slackBotTokenEncrypted: encrypt(token),
                slackTeamId: auth.teamId,
                slackTeamName: auth.teamName,
                slackBotUserId: auth.botUserId,
                slackConfigUpdatedAt: now,
            },
        });

        return NextResponse.json({
            success: true,
            slackTeamName: auth.teamName,
            slackBotUserId: auth.botUserId,
            slackConfigUpdatedAt: now.toISOString(),
        });
    } catch (error) {
        logger.warn('Failed to save team Slack settings', {
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
            error: 'Failed to save Slack settings',
        });
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
        await prisma.team.update({
            where: { id: guard.teamId },
            data: {
                slackBotTokenEncrypted: null,
                slackTeamId: null,
                slackTeamName: null,
                slackBotUserId: null,
                slackConfigUpdatedAt: null,
            },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to clear team Slack settings', error);
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to clear Slack settings',
        });
    }
}

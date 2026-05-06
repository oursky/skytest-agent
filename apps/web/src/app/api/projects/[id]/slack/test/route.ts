import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { apiError } from '@/lib/security/api-route-standards';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { decrypt } from '@/lib/security/crypto';
import { postMessage } from '@/lib/integrations/slack/client';
import {
    SlackApiError,
    SlackAuthError,
    SlackChannelNotFoundError,
} from '@/lib/integrations/slack/errors';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
    renderTemplate,
} from '@/lib/integrations/slack/template';

const logger = createLogger('api:projects:slack-test');

function mapSlackPostError(error: unknown): NextResponse {
    if (error instanceof SlackAuthError) {
        return NextResponse.json({
            error: 'TEAM_TOKEN_INVALID',
            message: 'Team Slack token is invalid. Reconnect it in Team Settings → Integration.',
        }, { status: 409 });
    }

    if (error instanceof SlackChannelNotFoundError) {
        return NextResponse.json({
            error: 'INVALID_CHANNEL',
            field: 'slackChannelId',
        }, { status: 400 });
    }

    if (error instanceof SlackApiError && error.retryable) {
        return NextResponse.json({
            error: 'SLACK_UPSTREAM',
        }, { status: 502 });
    }

    return apiError({
        status: 500,
        code: 'INTERNAL_ERROR',
        error: 'Failed to send Slack test message',
    });
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const project = await prisma.project.findUnique({
            where: { id: guard.params.id },
            select: {
                name: true,
                slackEnabled: true,
                slackChannelId: true,
                slackMessageTemplate: true,
                team: {
                    select: {
                        slackBotTokenEncrypted: true,
                    },
                },
            },
        });
        if (!project) {
            return apiError({
                status: 404,
                code: 'NOT_FOUND',
                error: 'Project not found',
            });
        }

        if (!project.slackEnabled || !project.slackChannelId) {
            return NextResponse.json({
                error: 'PROJECT_SLACK_NOT_CONFIGURED',
            }, { status: 409 });
        }

        if (!project.team.slackBotTokenEncrypted) {
            return NextResponse.json({
                error: 'TEAM_TOKEN_MISSING',
                message: 'Configure team Slack token in Team Settings → Integration.',
            }, { status: 409 });
        }

        const rendered = renderTemplate(
            project.slackMessageTemplate ?? DEFAULT_SLACK_FAILURE_TEMPLATE,
            {
                projectName: project.name,
                testCaseName: 'Checkout flow',
                runId: 'run_test_message',
                triggeredBy: 'qa@example.com',
                startedAt: '2026-04-29T12:00:00Z',
                completedAt: '2026-04-29T12:00:42Z',
                durationSeconds: 42,
                errorSummary: 'Element not found',
            }
        );

        const token = decrypt(project.team.slackBotTokenEncrypted);
        await postMessage({
            token,
            channel: project.slackChannelId,
            text: `🧪 Test message from SkyTest\n\n${rendered.text}`,
        });

        return NextResponse.json({
            success: true,
            truncated: rendered.truncated,
            missingVariables: rendered.missingVariables,
        });
    } catch (error) {
        logger.warn('Failed to send project Slack test message', {
            error: error instanceof Error ? error.message : String(error),
        });
        return mapSlackPostError(error);
    }
}

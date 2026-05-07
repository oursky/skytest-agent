import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { apiError } from '@/lib/security/api-route-standards';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { decrypt } from '@/lib/security/crypto';
import {
    joinConversation,
    postMessage,
} from '@/lib/integrations/slack/client';
import {
    SlackApiError,
    SlackAuthError,
    SlackChannelNotFoundError,
} from '@/lib/integrations/slack/errors';
import {
    buildSlackRunReference,
    formatSlackDateToken,
} from '@/lib/integrations/slack/message';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
    DEFAULT_SLACK_SUCCESS_TEMPLATE,
    rawSlack,
    renderTemplate,
} from '@/lib/integrations/slack/template';
import { TEST_STATUS } from '@/types';

const logger = createLogger('api:projects:slack-test');

async function sendTestMessageWithJoinFallback(input: {
    token: string;
    channelId: string;
    text: string;
}): Promise<void> {
    let channelMembershipError: SlackChannelNotFoundError | null = null;
    try {
        await postMessage({
            token: input.token,
            channel: input.channelId,
            text: input.text,
        });
        return;
    } catch (error) {
        if (!(error instanceof SlackChannelNotFoundError) || error.code !== 'not_in_channel') {
            throw error;
        }
        channelMembershipError = error;
    }

    try {
        await joinConversation({
            token: input.token,
            channelId: input.channelId,
        });
    } catch {
        throw channelMembershipError;
    }

    await postMessage({
        token: input.token,
        channel: input.channelId,
        text: input.text,
    });
}

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

function resolveStatus(value: unknown): typeof TEST_STATUS.FAIL | typeof TEST_STATUS.PASS {
    return value === TEST_STATUS.PASS ? TEST_STATUS.PASS : TEST_STATUS.FAIL;
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
                id: true,
                name: true,
                slackEnabled: true,
                slackChannelId: true,
                slackFailureTemplate: true,
                slackSuccessTemplate: true,
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

        const body = await request.json().catch(() => ({})) as {
            status?: string;
        };
        const status = resolveStatus(body.status);

        const now = new Date();
        const startedAt = now;
        const completedAt = new Date(startedAt.getTime() + 42_000);
        const durationSeconds = Math.max(0, Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000));
        const runReference = buildSlackRunReference({ runUrl: null, startedAt });

        const fallbackTemplate = status === TEST_STATUS.PASS
            ? DEFAULT_SLACK_SUCCESS_TEMPLATE
            : DEFAULT_SLACK_FAILURE_TEMPLATE;
        const selectedTemplate = status === TEST_STATUS.PASS
            ? (project.slackSuccessTemplate ?? fallbackTemplate)
            : (project.slackFailureTemplate ?? fallbackTemplate);

        const rendered = renderTemplate(selectedTemplate, {
            projectName: project.name,
            testCaseID: 'CASE-TEST-001',
            testCaseName: 'Checkout flow',
            runId: rawSlack(runReference),
            runReference: rawSlack(runReference),
            runRawId: 'run_test_message',
            triggeredBy: 'test@example.com',
            startedAt: rawSlack(formatSlackDateToken(startedAt)),
            completedAt: rawSlack(formatSlackDateToken(completedAt)),
            durationSeconds,
            errorSummary: 'Element not found',
        }, {
            fallbackTemplate,
        });

        const token = decrypt(project.team.slackBotTokenEncrypted);
        await sendTestMessageWithJoinFallback({
            token,
            channelId: project.slackChannelId,
            text: rendered.text,
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

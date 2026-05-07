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
    buildSlackRunMessage,
    resolveSlackAppBaseUrlFromEnv,
} from '@/lib/integrations/slack/message';
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

function resolveRequestBaseUrl(request: Request): string | null {
    try {
        const origin = new URL(request.url).origin;
        if (origin) {
            return origin;
        }
    } catch {
        // noop
    }

    return resolveSlackAppBaseUrlFromEnv();
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
                slackEnabled: true,
                slackChannelId: true,
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

        const latestRun = await prisma.testRun.findFirst({
            where: {
                testCase: {
                    projectId: project.id,
                },
                deletedAt: null,
            },
            orderBy: {
                createdAt: 'desc',
            },
            select: {
                id: true,
                startedAt: true,
                completedAt: true,
                error: true,
                testCase: {
                    select: {
                        id: true,
                        displayId: true,
                        name: true,
                    },
                },
            },
        });

        const now = new Date();
        const startedAt = latestRun?.startedAt ?? now;
        const completedAt = latestRun?.completedAt ?? new Date(startedAt.getTime() + 42_000);
        const durationSeconds = Math.max(0, Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000));
        const text = buildSlackRunMessage({
            status,
            testCaseDisplayId: latestRun?.testCase.displayId?.trim() || 'CASE-TEST-001',
            testCaseName: latestRun?.testCase.name || 'Checkout flow',
            testCaseId: latestRun?.testCase.id || 'test_case_sample',
            runId: latestRun?.id || 'run_test_message',
            startedAt,
            completedAt,
            errorSummary: latestRun?.error || 'Element not found',
            durationSeconds,
            appBaseUrl: resolveRequestBaseUrl(request),
        });

        const token = decrypt(project.team.slackBotTokenEncrypted);
        await sendTestMessageWithJoinFallback({
            token,
            channelId: project.slackChannelId,
            text,
        });

        return NextResponse.json({
            success: true,
        });
    } catch (error) {
        logger.warn('Failed to send project Slack test message', {
            error: error instanceof Error ? error.message : String(error),
        });
        return mapSlackPostError(error);
    }
}

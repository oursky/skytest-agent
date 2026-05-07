import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { apiError } from '@/lib/security/api-route-standards';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { decrypt } from '@/lib/security/crypto';
import {
    getConversationInfo,
} from '@/lib/integrations/slack/client';
import {
    SlackApiError,
    SlackAuthError,
    SlackChannelNotFoundError,
} from '@/lib/integrations/slack/errors';
import type { SlackConversationInfo } from '@/lib/integrations/slack/client';
import {
    PROJECT_SLACK_NOTIFY_ON,
    type ProjectSlackNotifyOn,
    type ProjectSlackSettings,
} from '@/types/slack';

const logger = createLogger('api:projects:slack');
const MAX_TEMPLATE_LENGTH = 3_500;

function normalizeOptionalText(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function projectSettingsResponse(input: {
    slackEnabled: boolean;
    slackNotifyOn: ProjectSlackNotifyOn;
    slackChannelId: string | null;
    slackChannelName: string | null;
    slackFailureTemplate: string | null;
    slackSuccessTemplate: string | null;
    slackUpdatedAt: Date | null;
    parentTeamHasToken: boolean;
}): ProjectSlackSettings {
    return {
        slackEnabled: input.slackEnabled,
        slackNotifyOn: input.slackNotifyOn,
        slackChannelId: input.slackChannelId,
        slackChannelName: input.slackChannelName,
        slackFailureTemplate: input.slackFailureTemplate,
        slackSuccessTemplate: input.slackSuccessTemplate,
        slackUpdatedAt: input.slackUpdatedAt?.toISOString() ?? null,
        parentTeamHasToken: input.parentTeamHasToken,
    };
}

function mapSlackValidationError(error: unknown): NextResponse {
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
        error: 'Failed to validate Slack configuration',
    });
}

export async function GET(
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
                slackEnabled: true,
                slackNotifyOn: true,
                slackChannelId: true,
                slackChannelName: true,
                slackFailureTemplate: true,
                slackSuccessTemplate: true,
                slackUpdatedAt: true,
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

        return NextResponse.json(projectSettingsResponse({
            slackEnabled: project.slackEnabled,
            slackNotifyOn: project.slackNotifyOn,
            slackChannelId: project.slackChannelId,
            slackChannelName: project.slackChannelName,
            slackFailureTemplate: project.slackFailureTemplate,
            slackSuccessTemplate: project.slackSuccessTemplate,
            slackUpdatedAt: project.slackUpdatedAt,
            parentTeamHasToken: Boolean(project.team.slackBotTokenEncrypted),
        }));
    } catch (error) {
        logger.error('Failed to load project Slack settings', error);
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
                slackNotifyOn: true,
                slackChannelId: true,
                slackChannelName: true,
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

        const body = await request.json() as {
            slackEnabled?: boolean;
            slackNotifyOn?: ProjectSlackNotifyOn | null;
            slackChannelId?: string | null;
            slackFailureTemplate?: string | null;
            slackSuccessTemplate?: string | null;
        };

        const slackEnabled = body.slackEnabled === true;
        const slackNotifyOn = body.slackNotifyOn === PROJECT_SLACK_NOTIFY_ON.BOTH_PASSED_AND_FAILED
            ? PROJECT_SLACK_NOTIFY_ON.BOTH_PASSED_AND_FAILED
            : PROJECT_SLACK_NOTIFY_ON.FAILED_ONLY;
        const slackChannelId = normalizeOptionalText(body.slackChannelId);
        const slackFailureTemplate = normalizeOptionalText(body.slackFailureTemplate);
        const slackSuccessTemplate = normalizeOptionalText(body.slackSuccessTemplate);

        if (slackFailureTemplate && slackFailureTemplate.length > MAX_TEMPLATE_LENGTH) {
            return NextResponse.json({
                error: 'INVALID_TEMPLATE',
                field: 'slackFailureTemplate',
                detail: `Template must be ${MAX_TEMPLATE_LENGTH} characters or fewer`,
            }, { status: 400 });
        }

        if (slackSuccessTemplate && slackSuccessTemplate.length > MAX_TEMPLATE_LENGTH) {
            return NextResponse.json({
                error: 'INVALID_TEMPLATE',
                field: 'slackSuccessTemplate',
                detail: `Template must be ${MAX_TEMPLATE_LENGTH} characters or fewer`,
            }, { status: 400 });
        }

        let channelInfo: SlackConversationInfo | null = null;
        if (slackEnabled) {
            if (!project.team.slackBotTokenEncrypted) {
                return NextResponse.json({
                    error: 'TEAM_TOKEN_MISSING',
                    message: 'Configure team Slack token in Team Settings → Integration.',
                }, { status: 409 });
            }

            if (!slackChannelId) {
                return NextResponse.json({
                    error: 'INVALID_CHANNEL',
                    field: 'slackChannelId',
                }, { status: 400 });
            }

            const token = decrypt(project.team.slackBotTokenEncrypted);
            try {
                channelInfo = await getConversationInfo({
                    token,
                    channelId: slackChannelId,
                });
            } catch (error) {
                return mapSlackValidationError(error);
            }
        }

        const channelIdChanged = slackChannelId !== (project.slackChannelId ?? null);
        const slackChannelName = channelInfo?.name
            ?? (slackChannelId
                ? (!slackEnabled && channelIdChanged ? null : project.slackChannelName)
                : null);

        const now = new Date();
        const updated = await prisma.project.update({
            where: { id: project.id },
            data: {
                slackEnabled,
                slackNotifyOn,
                slackChannelId,
                slackChannelName,
                slackFailureTemplate,
                slackSuccessTemplate,
                slackUpdatedAt: now,
            },
            select: {
                slackEnabled: true,
                slackNotifyOn: true,
                slackChannelId: true,
                slackChannelName: true,
                slackFailureTemplate: true,
                slackSuccessTemplate: true,
                slackUpdatedAt: true,
                team: {
                    select: {
                        slackBotTokenEncrypted: true,
                    },
                },
            },
        });

        return NextResponse.json(projectSettingsResponse({
            slackEnabled: updated.slackEnabled,
            slackNotifyOn: updated.slackNotifyOn,
            slackChannelId: updated.slackChannelId,
            slackChannelName: updated.slackChannelName,
            slackFailureTemplate: updated.slackFailureTemplate,
            slackSuccessTemplate: updated.slackSuccessTemplate,
            slackUpdatedAt: updated.slackUpdatedAt,
            parentTeamHasToken: Boolean(updated.team.slackBotTokenEncrypted),
        }));
    } catch (error) {
        logger.error('Failed to save project Slack settings', error);
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to save Slack settings',
        });
    }
}

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
import type { ProjectSlackSettings } from '@/types/slack';

const logger = createLogger('api:projects:slack');
const MAX_TEMPLATE_LENGTH = 3_500;
const USER_MENTION_PATTERN = /^@[UW][A-Z0-9]+(?:\|[^|<>]+)?$/;
const SPECIAL_MENTION_PATTERN = /^!(?:here|channel|everyone|subteam\^[A-Z0-9]+)(?:\|[^|<>]+)?$/;

function normalizeOptionalText(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function validateMentionMarkup(template: string): string | null {
    const matches = template.matchAll(/<([^>\r\n]+)>/g);
    for (const match of matches) {
        const raw = match[1] ?? '';
        if (raw.startsWith('@') && !USER_MENTION_PATTERN.test(raw)) {
            return `Invalid mention markup "${match[0]}". Use <@U123ABC>, <@W123ABC>, or include an optional fallback label.`;
        }
        if (raw.startsWith('!') && !SPECIAL_MENTION_PATTERN.test(raw)) {
            return `Invalid mention markup "${match[0]}". Use <!here>, <!channel>, <!everyone>, or <!subteam^S123ABC>.`;
        }
    }
    return null;
}

function projectSettingsResponse(input: {
    slackEnabled: boolean;
    slackChannelId: string | null;
    slackChannelName: string | null;
    slackMessageTemplate: string | null;
    slackUpdatedAt: Date | null;
    parentTeamHasToken: boolean;
}): ProjectSlackSettings {
    return {
        slackEnabled: input.slackEnabled,
        slackChannelId: input.slackChannelId,
        slackChannelName: input.slackChannelName,
        slackMessageTemplate: input.slackMessageTemplate,
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
                slackChannelId: true,
                slackChannelName: true,
                slackMessageTemplate: true,
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
            slackChannelId: project.slackChannelId,
            slackChannelName: project.slackChannelName,
            slackMessageTemplate: project.slackMessageTemplate,
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
                slackChannelId: true,
                slackChannelName: true,
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
            slackChannelId?: string | null;
            slackMessageTemplate?: string | null;
        };

        const slackEnabled = body.slackEnabled === true;
        const slackChannelId = normalizeOptionalText(body.slackChannelId);
        const slackMessageTemplate = normalizeOptionalText(body.slackMessageTemplate);

        if (slackMessageTemplate && slackMessageTemplate.length > MAX_TEMPLATE_LENGTH) {
            return NextResponse.json({
                error: 'INVALID_TEMPLATE',
                field: 'slackMessageTemplate',
                detail: `Template must be ${MAX_TEMPLATE_LENGTH} characters or fewer`,
            }, { status: 400 });
        }

        if (slackMessageTemplate) {
            const mentionError = validateMentionMarkup(slackMessageTemplate);
            if (mentionError) {
                return NextResponse.json({
                    error: 'INVALID_TEMPLATE',
                    field: 'slackMessageTemplate',
                    detail: mentionError,
                }, { status: 400 });
            }
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
                slackChannelId,
                slackChannelName,
                slackMessageTemplate,
                slackUpdatedAt: now,
            },
            select: {
                slackEnabled: true,
                slackChannelId: true,
                slackChannelName: true,
                slackMessageTemplate: true,
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
            slackChannelId: updated.slackChannelId,
            slackChannelName: updated.slackChannelName,
            slackMessageTemplate: updated.slackMessageTemplate,
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

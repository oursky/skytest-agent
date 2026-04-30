import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { config as appConfig } from '@/config/app';
import { decrypt } from '@/lib/security/crypto';
import { postMessage } from '@/lib/integrations/slack/client';
import { SlackApiError } from '@/lib/integrations/slack/errors';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
    renderTemplate,
} from '@/lib/integrations/slack/template';
import { TEST_STATUS } from '@/types';

const logger = createLogger('integrations:slack:notifier');
const MAX_ERROR_SUMMARY_LENGTH = 500;

function trimErrorSummary(value: string | null): string {
    if (!value) {
        return 'Unknown error';
    }

    if (value.length <= MAX_ERROR_SUMMARY_LENGTH) {
        return value;
    }

    return `${value.slice(0, MAX_ERROR_SUMMARY_LENGTH)}...`;
}

function buildRunUrl(baseUrl: string, runId: string, testCaseId: string): string {
    const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalized}/run?runId=${encodeURIComponent(runId)}&testCaseId=${encodeURIComponent(testCaseId)}`;
}

function formatTimestamp(value: Date | null): string {
    if (!value) {
        return '-';
    }

    return value.toISOString();
}

async function clearSlackClaim(runId: string): Promise<void> {
    await prisma.testRun.update({
        where: { id: runId },
        data: {
            slackNotifyClaimedAt: null,
        },
    });
}

async function markSlackNotified(runId: string, error: string | null): Promise<void> {
    await prisma.testRun.update({
        where: { id: runId },
        data: {
            slackNotifiedAt: new Date(),
            slackNotifyClaimedAt: null,
            slackNotifyError: error,
        },
    });
}

export async function notifyRunFailed(runId: string): Promise<void> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            status: true,
            testCaseId: true,
            triggeredByEmail: true,
            startedAt: true,
            completedAt: true,
            error: true,
            slackNotifyAttempts: true,
            testCase: {
                select: {
                    id: true,
                    name: true,
                    project: {
                        select: {
                            id: true,
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
                    },
                },
            },
        },
    });

    if (!run || run.status !== TEST_STATUS.FAIL) {
        return;
    }

    const tokenEncrypted = run.testCase.project.team.slackBotTokenEncrypted;
    const channelId = run.testCase.project.slackChannelId;
    if (!run.testCase.project.slackEnabled || !tokenEncrypted || !channelId) {
        return;
    }

    const now = new Date();
    const claimCutoff = new Date(now.getTime() - appConfig.slack.notifications.claimTtlMs);
    const claimResult = await prisma.testRun.updateMany({
        where: {
            id: run.id,
            slackNotifiedAt: null,
            OR: [
                { slackNotifyClaimedAt: null },
                { slackNotifyClaimedAt: { lt: claimCutoff } },
            ],
        },
        data: {
            slackNotifyClaimedAt: now,
            slackNotifyAttempts: { increment: 1 },
        },
    });

    if (claimResult.count !== 1) {
        return;
    }
    const claimedRun = await prisma.testRun.findUnique({
        where: { id: run.id },
        select: {
            slackNotifyAttempts: true,
        },
    });
    if (!claimedRun) {
        return;
    }
    const attemptsAfterClaim = claimedRun.slackNotifyAttempts;

    const baseUrl = appConfig.app.publicBaseUrl ?? '';
    if (!baseUrl) {
        await markSlackNotified(run.id, 'APP_BASE_URL_MISSING');
        logger.warn('Slack notification skipped because APP_BASE_URL is missing', { runId: run.id });
        return;
    }

    const runUrl = buildRunUrl(baseUrl, run.id, run.testCaseId);
    const template = run.testCase.project.slackMessageTemplate ?? DEFAULT_SLACK_FAILURE_TEMPLATE;
    const rendered = renderTemplate(template, {
        projectName: run.testCase.project.name,
        testCaseName: run.testCase.name,
        runId: run.id,
        runUrl,
        triggeredBy: run.triggeredByEmail ?? 'system',
        startedAt: formatTimestamp(run.startedAt),
        completedAt: formatTimestamp(run.completedAt),
        durationSeconds: run.startedAt && run.completedAt
            ? Math.max(0, Math.floor((run.completedAt.getTime() - run.startedAt.getTime()) / 1000))
            : 0,
        errorSummary: trimErrorSummary(run.error),
    });
    if (rendered.truncated || rendered.missingVariables.length > 0) {
        logger.info('Slack template required fallback rendering', {
            runId: run.id,
            truncated: rendered.truncated,
            missingVariables: rendered.missingVariables,
        });
    }

    try {
        const token = decrypt(tokenEncrypted);
        await postMessage({
            token,
            channel: channelId,
            text: rendered.text,
        });
        await markSlackNotified(run.id, null);
    } catch (error) {
        const attemptsExhausted = attemptsAfterClaim >= appConfig.slack.notifications.maxAttempts;
        if (error instanceof SlackApiError) {
            if (!error.retryable) {
                await markSlackNotified(run.id, error.code);
                return;
            }

            if (attemptsExhausted) {
                await markSlackNotified(run.id, `${error.code}:max_attempts`);
                return;
            }

            await clearSlackClaim(run.id);
            return;
        }

        logger.warn('Unexpected Slack notification failure', {
            runId: run.id,
            error: error instanceof Error ? error.message : String(error),
        });
        if (attemptsExhausted) {
            await markSlackNotified(run.id, 'unexpected:max_attempts');
            return;
        }
        await clearSlackClaim(run.id);
    }
}

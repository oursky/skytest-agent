import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { decrypt } from '@/lib/security/crypto';
import { postMessage } from '@/lib/integrations/slack/client';
import { SlackApiError } from '@/lib/integrations/slack/errors';
import { slackNotificationPolicy } from '@/lib/integrations/slack/config';
import {
    buildSlackRunMessage,
    resolveSlackAppBaseUrlFromEnv,
} from '@/lib/integrations/slack/message';
import { PROJECT_SLACK_NOTIFY_ON } from '@/types/slack';
import { TEST_STATUS } from '@/types';

const logger = createLogger('integrations:slack:notifier');
const MAX_ERROR_SUMMARY_LENGTH = 500;
const slackAppBaseUrl = resolveSlackAppBaseUrlFromEnv();

function trimErrorSummary(value: string | null): string {
    if (!value) {
        return 'Unknown error';
    }

    if (value.length <= MAX_ERROR_SUMMARY_LENGTH) {
        return value;
    }

    return `${value.slice(0, MAX_ERROR_SUMMARY_LENGTH)}...`;
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

export async function notifyRunTerminal(runId: string): Promise<void> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            status: true,
            triggeredByEmail: true,
            startedAt: true,
            completedAt: true,
            error: true,
            slackNotifyAttempts: true,
            testCase: {
                select: {
                    id: true,
                    displayId: true,
                    name: true,
                    project: {
                        select: {
                            id: true,
                            name: true,
                            slackEnabled: true,
                            slackNotifyOn: true,
                            slackChannelId: true,
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

    if (!run || (run.status !== TEST_STATUS.FAIL && run.status !== TEST_STATUS.PASS)) {
        return;
    }

    const tokenEncrypted = run.testCase.project.team.slackBotTokenEncrypted;
    const channelId = run.testCase.project.slackChannelId;
    if (!run.testCase.project.slackEnabled || !tokenEncrypted || !channelId) {
        return;
    }
    if (run.status === TEST_STATUS.PASS && run.testCase.project.slackNotifyOn !== PROJECT_SLACK_NOTIFY_ON.BOTH_PASSED_AND_FAILED) {
        return;
    }

    const now = new Date();
    const claimCutoff = new Date(now.getTime() - slackNotificationPolicy.claimTtlMs);
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

    const isFailedRun = run.status === TEST_STATUS.FAIL;
    const testCaseDisplayId = (run.testCase.displayId || '').trim() || run.testCase.id;
    const messageText = buildSlackRunMessage({
        status: isFailedRun ? TEST_STATUS.FAIL : TEST_STATUS.PASS,
        testCaseDisplayId,
        testCaseName: run.testCase.name,
        runId: run.id,
        testCaseId: run.testCase.id,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        errorSummary: isFailedRun ? trimErrorSummary(run.error) : '-',
        durationSeconds: run.startedAt && run.completedAt
            ? Math.max(0, Math.floor((run.completedAt.getTime() - run.startedAt.getTime()) / 1000))
            : 0,
        appBaseUrl: slackAppBaseUrl,
    });

    try {
        const token = decrypt(tokenEncrypted);
        await postMessage({
            token,
            channel: channelId,
            text: messageText,
        });
        await markSlackNotified(run.id, null);
    } catch (error) {
        const attemptsExhausted = attemptsAfterClaim >= slackNotificationPolicy.maxAttempts;
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

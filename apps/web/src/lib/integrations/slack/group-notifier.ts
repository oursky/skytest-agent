import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { decrypt } from '@/lib/security/crypto';
import { postMessage } from '@/lib/integrations/slack/client';
import { SlackApiError } from '@/lib/integrations/slack/errors';
import { slackNotificationPolicy } from '@/lib/integrations/slack/config';
import {
    buildTestGroupUrl,
    formatSlackDateToken,
    resolveSlackAppBaseUrlFromEnv,
} from '@/lib/integrations/slack/message';
import {
    DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE,
    DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE,
    rawSlack,
    renderTemplate,
} from '@/lib/integrations/slack/template';
import { SLACK_NOTIFY_OUTCOME, type SlackNotifyOutcome } from '@/lib/integrations/slack/notifier';
import { PROJECT_SLACK_NOTIFY_ON } from '@/types/slack';
import { RUN_SESSION_KIND, TEST_STATUS } from '@/types';

const logger = createLogger('integrations:slack:group-notifier');
const slackAppBaseUrl = resolveSlackAppBaseUrlFromEnv();

async function clearGroupClaim(sessionId: string): Promise<void> {
    await prisma.runSession.update({ where: { id: sessionId }, data: { slackNotifyClaimedAt: null } });
}

async function markGroupNotified(sessionId: string, error: string | null): Promise<void> {
    await prisma.runSession.update({
        where: { id: sessionId },
        data: { slackNotifiedAt: new Date(), slackNotifyClaimedAt: null, slackNotifyError: error },
    });
}

/**
 * Posts one Slack message summarizing a finished GROUP run session, replacing the
 * suppressed per-case notifications. Uses the same claim/retry columns pattern as
 * the per-run notifier, on RunSession instead of TestRun.
 */
export async function notifyTestGroupTerminal(sessionId: string): Promise<SlackNotifyOutcome> {
    const session = await prisma.runSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            kind: true,
            status: true,
            projectId: true,
            startedAt: true,
            completedAt: true,
            triggeredByEmail: true,
            slackNotifyAttempts: true,
            testGroup: { select: { name: true, displayId: true } },
            project: {
                select: {
                    name: true,
                    slackEnabled: true,
                    slackChannelId: true,
                    slackGroupNotifyEnabled: true,
                    slackGroupNotifyOn: true,
                    slackGroupSuccessTemplate: true,
                    slackGroupFailureTemplate: true,
                    team: { select: { slackBotTokenEncrypted: true } },
                },
            },
            memberRuns: { select: { status: true } },
        },
    });

    if (!session || session.kind !== RUN_SESSION_KIND.GROUP) {
        return SLACK_NOTIFY_OUTCOME.SKIPPED;
    }
    if (session.status !== TEST_STATUS.FAIL && session.status !== TEST_STATUS.PASS) {
        return SLACK_NOTIFY_OUTCOME.SKIPPED;
    }

    const project = session.project;
    const tokenEncrypted = project.team.slackBotTokenEncrypted;
    if (!project.slackEnabled || !project.slackGroupNotifyEnabled || !tokenEncrypted || !project.slackChannelId) {
        return SLACK_NOTIFY_OUTCOME.SKIPPED;
    }
    if (session.status === TEST_STATUS.PASS && project.slackGroupNotifyOn !== PROJECT_SLACK_NOTIFY_ON.BOTH_PASSED_AND_FAILED) {
        return SLACK_NOTIFY_OUTCOME.SKIPPED;
    }

    const now = new Date();
    const claimCutoff = new Date(now.getTime() - slackNotificationPolicy.claimTtlMs);
    const claimResult = await prisma.runSession.updateMany({
        where: {
            id: session.id,
            slackNotifiedAt: null,
            OR: [{ slackNotifyClaimedAt: null }, { slackNotifyClaimedAt: { lt: claimCutoff } }],
        },
        data: { slackNotifyClaimedAt: now, slackNotifyAttempts: { increment: 1 } },
    });
    if (claimResult.count !== 1) {
        return SLACK_NOTIFY_OUTCOME.SKIPPED;
    }
    const attemptsAfterClaim = session.slackNotifyAttempts + 1;

    const isFailed = session.status === TEST_STATUS.FAIL;
    const fallbackTemplate = isFailed ? DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE : DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE;
    const selectedTemplate = isFailed
        ? (project.slackGroupFailureTemplate ?? fallbackTemplate)
        : (project.slackGroupSuccessTemplate ?? fallbackTemplate);

    const passedCount = session.memberRuns.filter((member) => member.status === TEST_STATUS.PASS).length;
    const runLink = buildTestGroupUrl({ appBaseUrl: slackAppBaseUrl, projectId: session.projectId, sessionId: session.id });
    const groupName = (session.testGroup?.displayId ? `${session.testGroup.displayId} ` : '') + (session.testGroup?.name ?? '');

    const rendered = renderTemplate(selectedTemplate, {
        projectName: project.name,
        groupName: groupName.trim() || '-',
        passedCount,
        totalCount: session.memberRuns.length,
        runLink: runLink ?? '-',
        triggeredBy: session.triggeredByEmail ?? 'system',
        startedAt: rawSlack(formatSlackDateToken(session.startedAt)),
        completedAt: rawSlack(formatSlackDateToken(session.completedAt)),
    }, { fallbackTemplate });

    try {
        const token = decrypt(tokenEncrypted);
        await postMessage({ token, channel: project.slackChannelId, text: rendered.text });
        await markGroupNotified(session.id, null);
        return SLACK_NOTIFY_OUTCOME.NOTIFIED;
    } catch (error) {
        const attemptsExhausted = attemptsAfterClaim >= slackNotificationPolicy.maxAttempts;
        if (error instanceof SlackApiError) {
            if (!error.retryable) {
                await markGroupNotified(session.id, error.code);
                return SLACK_NOTIFY_OUTCOME.EXHAUSTED;
            }
            if (attemptsExhausted) {
                await markGroupNotified(session.id, `${error.code}:max_attempts`);
                return SLACK_NOTIFY_OUTCOME.EXHAUSTED;
            }
            await clearGroupClaim(session.id);
            return SLACK_NOTIFY_OUTCOME.RETRY_PENDING;
        }
        logger.warn('Unexpected Slack group notification failure', {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error),
        });
        if (attemptsExhausted) {
            await markGroupNotified(session.id, 'unexpected:max_attempts');
            return SLACK_NOTIFY_OUTCOME.EXHAUSTED;
        }
        await clearGroupClaim(session.id);
        return SLACK_NOTIFY_OUTCOME.RETRY_PENDING;
    }
}

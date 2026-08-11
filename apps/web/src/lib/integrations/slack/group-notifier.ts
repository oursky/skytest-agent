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
import { resolveLatestAttempts } from '@/lib/runtime/test-group-retry-plan';
import { RUN_SESSION_KIND, TEST_STATUS, isRunTerminalStatus } from '@/types';

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
                    slackGroupFailureTemplate: true,
                    slackGroupSuccessTemplate: true,
                    team: { select: { slackBotTokenEncrypted: true } },
                },
            },
            memberRuns: { select: { status: true, testCaseId: true, attempt: true, sessionPosition: true } },
        },
    });

    if (!session || session.kind !== RUN_SESSION_KIND.GROUP) {
        return SLACK_NOTIFY_OUTCOME.SKIPPED;
    }
    // Notify once the group settles to any non-cancelled terminal status (pass,
    // fail, or finished-with-skipped). Cancelled/stopped runs never notify.
    if (!isRunTerminalStatus(session.status) || session.status === TEST_STATUS.CANCELLED) {
        return SLACK_NOTIFY_OUTCOME.SKIPPED;
    }

    const project = session.project;
    const tokenEncrypted = project.team.slackBotTokenEncrypted;
    if (!project.slackEnabled || !project.slackGroupNotifyEnabled || !tokenEncrypted || !project.slackChannelId) {
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

    const passed = session.status === TEST_STATUS.PASS;
    // Retried cases have one row per attempt; count each case once by its final attempt so a
    // group that recovered on retry does not report its earlier failures in the totals.
    const finalAttempts = resolveLatestAttempts(session.memberRuns);
    const passedCount = finalAttempts.filter((member) => member.status === TEST_STATUS.PASS).length;
    const runLink = buildTestGroupUrl({ appBaseUrl: slackAppBaseUrl, projectId: session.projectId, sessionId: session.id });
    const groupName = (session.testGroup?.displayId ? `${session.testGroup.displayId} ` : '') + (session.testGroup?.name ?? '');

    const fallbackTemplate = passed ? DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE : DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE;
    const selectedTemplate = (passed ? project.slackGroupSuccessTemplate : project.slackGroupFailureTemplate) ?? fallbackTemplate;
    const rendered = renderTemplate(selectedTemplate, {
        projectName: project.name,
        groupName: groupName.trim() || '-',
        passedCount,
        totalCount: finalAttempts.length,
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

import { createLogger } from '@/lib/core/logger';
import { notifyRunTerminal } from '@/lib/integrations/slack/notifier';
import { notifyRunGroupTerminal } from '@/lib/integrations/slack/group-notifier';
import { subscribeRunSessionTerminal, subscribeRunTerminal } from '@/lib/runners/domain-events';
import { RUN_SESSION_KIND, TEST_STATUS } from '@/types';

const logger = createLogger('integrations:slack:subscriber');
const MAX_CONCURRENT_NOTIFICATIONS = 4;
const MAX_QUEUED_NOTIFICATIONS = 100;

let registered = false;
let unsubscribeListener: (() => void) | null = null;
let activeNotifications = 0;
const pendingRunIds: string[] = [];

let groupRegistered = false;
let unsubscribeGroupListener: (() => void) | null = null;
let activeGroupNotifications = 0;
const pendingGroupSessionIds: string[] = [];

function pumpNotificationQueue(): void {
    while (activeNotifications < MAX_CONCURRENT_NOTIFICATIONS && pendingRunIds.length > 0) {
        const runId = pendingRunIds.shift();
        if (!runId) {
            return;
        }

        activeNotifications += 1;
        void notifyRunTerminal(runId).catch((error) => {
            logger.warn('Slack notification failed in subscriber', {
                runId,
                error: error instanceof Error ? error.message : String(error),
            });
        }).finally(() => {
            activeNotifications = Math.max(0, activeNotifications - 1);
            pumpNotificationQueue();
        });
    }
}

function enqueueSlackNotification(runId: string): void {
    if (pendingRunIds.length >= MAX_QUEUED_NOTIFICATIONS) {
        logger.warn('Dropping Slack notification due to saturated queue', {
            runId,
            queueDepth: pendingRunIds.length,
            maxQueueDepth: MAX_QUEUED_NOTIFICATIONS,
        });
        return;
    }

    pendingRunIds.push(runId);
    pumpNotificationQueue();
}

export function registerSlackSubscriber(): void {
    if (registered) {
        return;
    }

    unsubscribeListener = subscribeRunTerminal((event) => {
        if (event.status !== TEST_STATUS.FAIL && event.status !== TEST_STATUS.PASS) {
            return;
        }

        enqueueSlackNotification(event.runId);
    });
    registered = true;
}

export function resetSlackSubscriberForTests(): void {
    if (unsubscribeListener) {
        unsubscribeListener();
        unsubscribeListener = null;
    }
    pendingRunIds.length = 0;
    activeNotifications = 0;
    registered = false;
}

function pumpGroupNotificationQueue(): void {
    while (activeGroupNotifications < MAX_CONCURRENT_NOTIFICATIONS && pendingGroupSessionIds.length > 0) {
        const sessionId = pendingGroupSessionIds.shift();
        if (!sessionId) {
            return;
        }
        activeGroupNotifications += 1;
        void notifyRunGroupTerminal(sessionId).catch((error) => {
            logger.warn('Slack group notification failed in subscriber', {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
            });
        }).finally(() => {
            activeGroupNotifications = Math.max(0, activeGroupNotifications - 1);
            pumpGroupNotificationQueue();
        });
    }
}

function enqueueGroupNotification(sessionId: string): void {
    if (pendingGroupSessionIds.length >= MAX_QUEUED_NOTIFICATIONS) {
        logger.warn('Dropping Slack group notification due to saturated queue', { sessionId });
        return;
    }
    pendingGroupSessionIds.push(sessionId);
    pumpGroupNotificationQueue();
}

export function registerSlackGroupSubscriber(): void {
    if (groupRegistered) {
        return;
    }
    unsubscribeGroupListener = subscribeRunSessionTerminal((event) => {
        if (event.kind !== RUN_SESSION_KIND.GROUP) {
            return;
        }
        if (event.status !== TEST_STATUS.FAIL && event.status !== TEST_STATUS.PASS) {
            return;
        }
        enqueueGroupNotification(event.sessionId);
    });
    groupRegistered = true;
}

export function resetSlackGroupSubscriberForTests(): void {
    if (unsubscribeGroupListener) {
        unsubscribeGroupListener();
        unsubscribeGroupListener = null;
    }
    pendingGroupSessionIds.length = 0;
    activeGroupNotifications = 0;
    groupRegistered = false;
}

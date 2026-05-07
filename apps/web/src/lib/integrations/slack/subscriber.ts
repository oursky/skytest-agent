import { createLogger } from '@/lib/core/logger';
import { notifyRunTerminal } from '@/lib/integrations/slack/notifier';
import { subscribeRunTerminal } from '@/lib/runners/domain-events';
import { TEST_STATUS } from '@/types';

const logger = createLogger('integrations:slack:subscriber');
const MAX_CONCURRENT_NOTIFICATIONS = 4;
const MAX_QUEUED_NOTIFICATIONS = 100;

let registered = false;
let unsubscribeListener: (() => void) | null = null;
let activeNotifications = 0;
const pendingRunIds: string[] = [];

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

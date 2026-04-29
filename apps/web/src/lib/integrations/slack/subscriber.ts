import { createLogger } from '@/lib/core/logger';
import { notifyRunFailed } from '@/lib/integrations/slack/notifier';
import { subscribeRunTerminal } from '@/lib/runners/domain-events';
import { TEST_STATUS } from '@/types';

const logger = createLogger('integrations:slack:subscriber');

let registered = false;
let unsubscribeListener: (() => void) | null = null;

function isSlackNotificationsEnabled(): boolean {
    return process.env.SKYTEST_SLACK_NOTIFICATIONS === 'true';
}

export function registerSlackSubscriber(): void {
    if (!isSlackNotificationsEnabled()) {
        return;
    }

    if (registered) {
        return;
    }

    unsubscribeListener = subscribeRunTerminal((event) => {
        if (event.status !== TEST_STATUS.FAIL) {
            return;
        }

        void notifyRunFailed(event.runId).catch((error) => {
            logger.warn('Slack notification failed in subscriber', {
                runId: event.runId,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    });
    registered = true;
}

export function resetSlackSubscriberForTests(): void {
    if (unsubscribeListener) {
        unsubscribeListener();
        unsubscribeListener = null;
    }
    registered = false;
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    subscribeRunTerminalMock,
    notifyRunFailedMock,
} = vi.hoisted(() => ({
    subscribeRunTerminalMock: vi.fn(),
    notifyRunFailedMock: vi.fn(),
}));

vi.mock('@/lib/runners/domain-events', () => ({
    subscribeRunTerminal: subscribeRunTerminalMock,
}));

vi.mock('@/lib/integrations/slack/notifier', () => ({
    notifyRunFailed: notifyRunFailedMock,
}));

const {
    registerSlackSubscriber,
    resetSlackSubscriberForTests,
} = await import('@/lib/integrations/slack/subscriber');

describe('registerSlackSubscriber', () => {
    beforeEach(() => {
        subscribeRunTerminalMock.mockReset();
        notifyRunFailedMock.mockReset();
        notifyRunFailedMock.mockResolvedValue(undefined);
        resetSlackSubscriberForTests();
        vi.stubEnv('SKYTEST_SLACK_NOTIFICATIONS', 'true');
    });

    it('notifies only for FAIL events', async () => {
        subscribeRunTerminalMock.mockImplementation(() => () => undefined);

        registerSlackSubscriber();
        const listener = subscribeRunTerminalMock.mock.calls[0]?.[0] as ((event: { runId: string; status: string }) => void) | undefined;
        if (!listener) {
            throw new Error('listener was not registered');
        }

        listener({ runId: 'run-pass', status: 'PASS' });
        listener({ runId: 'run-fail', status: 'FAIL' });
        await Promise.resolve();

        expect(notifyRunFailedMock).toHaveBeenCalledTimes(1);
        expect(notifyRunFailedMock).toHaveBeenCalledWith('run-fail');
    });

    it('registers only once even when called multiple times', () => {
        subscribeRunTerminalMock.mockImplementation(() => () => undefined);

        registerSlackSubscriber();
        registerSlackSubscriber();

        expect(subscribeRunTerminalMock).toHaveBeenCalledTimes(1);
    });
});

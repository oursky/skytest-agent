import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    subscribeRunTerminalMock,
    notifyRunTerminalMock,
} = vi.hoisted(() => ({
    subscribeRunTerminalMock: vi.fn(),
    notifyRunTerminalMock: vi.fn(),
}));

vi.mock('@/lib/runners/domain-events', () => ({
    subscribeRunTerminal: subscribeRunTerminalMock,
}));

vi.mock('@/lib/integrations/slack/notifier', () => ({
    notifyRunTerminal: notifyRunTerminalMock,
}));

const {
    registerSlackSubscriber,
    resetSlackSubscriberForTests,
} = await import('@/lib/integrations/slack/subscriber');

describe('registerSlackSubscriber', () => {
    beforeEach(() => {
        subscribeRunTerminalMock.mockReset();
        notifyRunTerminalMock.mockReset();
        notifyRunTerminalMock.mockResolvedValue(undefined);
        resetSlackSubscriberForTests();
    });

    it('notifies for PASS and FAIL events only', async () => {
        subscribeRunTerminalMock.mockImplementation(() => () => undefined);

        registerSlackSubscriber();
        const listener = subscribeRunTerminalMock.mock.calls[0]?.[0] as ((event: { runId: string; status: string }) => void) | undefined;
        if (!listener) {
            throw new Error('listener was not registered');
        }

        listener({ runId: 'run-pass', status: 'PASS' });
        listener({ runId: 'run-fail', status: 'FAIL' });
        listener({ runId: 'run-cancelled', status: 'CANCELLED' });
        await Promise.resolve();

        expect(notifyRunTerminalMock).toHaveBeenCalledTimes(2);
        expect(notifyRunTerminalMock).toHaveBeenNthCalledWith(1, 'run-pass');
        expect(notifyRunTerminalMock).toHaveBeenNthCalledWith(2, 'run-fail');
    });

    it('registers only once even when called multiple times', () => {
        subscribeRunTerminalMock.mockImplementation(() => () => undefined);

        registerSlackSubscriber();
        registerSlackSubscriber();

        expect(subscribeRunTerminalMock).toHaveBeenCalledTimes(1);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    registerSlackSubscriber: vi.fn(),
    registerSlackGroupSubscriber: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    prismaDisconnect: vi.fn(),
    dispatchQueuedBrowserRuns: vi.fn(),
    abortInactiveLocalBrowserRuns: vi.fn(),
    sleepOrWake: vi.fn(),
    wake: vi.fn(),
    isShutdownRequested: vi.fn(),
    requestShutdown: vi.fn(),
}));

vi.mock('@/config/app', () => ({
    config: {
        browserWorker: {
            enabled: true,
            dispatchIntervalMs: 10,
            maxDispatchIntervalMs: 100,
            maxDispatchesPerCycle: 2,
        },
        runner: {
            maxLocalBrowserRuns: 2,
            maxConcurrentRuns: 2,
        },
    },
}));

vi.mock('@/lib/integrations/slack/subscriber', () => ({
    registerSlackSubscriber: mocks.registerSlackSubscriber,
    registerSlackGroupSubscriber: mocks.registerSlackGroupSubscriber,
}));

vi.mock('@/lib/core/logger', () => ({
    createLogger: () => ({
        info: mocks.loggerInfo,
        warn: mocks.loggerWarn,
        error: mocks.loggerError,
    }),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        $disconnect: mocks.prismaDisconnect,
    },
}));

vi.mock('@/lib/runtime/browser-run-dispatcher', () => ({
    dispatchQueuedBrowserRuns: mocks.dispatchQueuedBrowserRuns,
}));

vi.mock('@/lib/runtime/local-browser-runner', () => ({
    abortInactiveLocalBrowserRuns: mocks.abortInactiveLocalBrowserRuns,
}));

vi.mock('@/workers/loop-utils', () => ({
    createWakeableSleeper: () => ({
        sleepOrWake: mocks.sleepOrWake,
        wake: mocks.wake,
    }),
    createWorkerShutdownController: () => ({
        isShutdownRequested: mocks.isShutdownRequested,
        requestShutdown: mocks.requestShutdown,
    }),
}));

describe('browser runner worker bootstrap', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.prismaDisconnect.mockResolvedValue(undefined);
        mocks.isShutdownRequested.mockReturnValue(true);
    });

    it('registers Slack terminal run subscriber on startup', async () => {
        await import('@/workers/browser-runner');
        await Promise.resolve();

        expect(mocks.registerSlackSubscriber).toHaveBeenCalledTimes(1);
    });
});

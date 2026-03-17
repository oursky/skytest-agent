import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runTest: vi.fn(),
    resolveConfigs: vi.fn(),
    decrypt: vi.fn(),
    publishRunUpdate: vi.fn(),
    dispatchNextQueuedBrowserRun: vi.fn(),
    testRunFindUnique: vi.fn(),
    testRunFindFirst: vi.fn(),
    testRunFindMany: vi.fn(),
    testRunUpdateMany: vi.fn(),
    testCaseUpdate: vi.fn(),
    testRunEventCreateMany: vi.fn(),
    testRunFileCreate: vi.fn(),
    userFindUnique: vi.fn(),
    projectFindUnique: vi.fn(),
    usageRecordUpsert: vi.fn(),
    usageRecordCreate: vi.fn(),
    transaction: vi.fn(),
    txTestRunFindUnique: vi.fn(),
}));

vi.mock('@/lib/runtime/test-runner', () => ({
    runTest: mocks.runTest,
}));

vi.mock('@/lib/test-config/resolver', () => ({
    resolveConfigs: mocks.resolveConfigs,
}));

vi.mock('@/lib/security/crypto', () => ({
    decrypt: mocks.decrypt,
}));

vi.mock('@/lib/runners/event-bus', () => ({
    publishRunUpdate: mocks.publishRunUpdate,
}));

vi.mock('@/lib/runtime/browser-run-dispatcher', () => ({
    dispatchNextQueuedBrowserRun: mocks.dispatchNextQueuedBrowserRun,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findUnique: mocks.testRunFindUnique,
            findFirst: mocks.testRunFindFirst,
            findMany: mocks.testRunFindMany,
            updateMany: mocks.testRunUpdateMany,
        },
        testCase: {
            update: mocks.testCaseUpdate,
        },
        testRunEvent: {
            createMany: mocks.testRunEventCreateMany,
        },
        testRunFile: {
            create: mocks.testRunFileCreate,
        },
        user: {
            findUnique: mocks.userFindUnique,
        },
        project: {
            findUnique: mocks.projectFindUnique,
        },
        usageRecord: {
            upsert: mocks.usageRecordUpsert,
            create: mocks.usageRecordCreate,
        },
        $transaction: mocks.transaction,
    },
}));

describe('local-browser-runner cancellation SLA integration', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        process.env.RUNNER_RUN_STATUS_POLL_INTERVAL_MS = '5000';
        process.env.RUNNER_RUN_STATUS_MAX_POLL_INTERVAL_MS = '30000';
        process.env.RUNNER_LEASE_DURATION_SECONDS = '120';

        mocks.resolveConfigs.mockResolvedValue({ variables: {}, files: {} });
        mocks.decrypt.mockReturnValue('sk-test');
        mocks.dispatchNextQueuedBrowserRun.mockResolvedValue(false);

        mocks.testRunFindUnique.mockResolvedValue({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            assignedRunnerId: null,
            leaseExpiresAt: null,
            configurationSnapshot: null,
            files: [],
            testCase: {
                id: 'tc-1',
                name: 'Checkout flow',
                url: 'https://example.com',
                prompt: null,
                steps: null,
                browserConfig: null,
                projectId: 'project-1',
                project: {
                    name: 'Shop',
                    createdByUserId: 'user-1',
                    team: {
                        openRouterKeyEncrypted: 'encrypted',
                    },
                },
            },
        });
        mocks.testRunFindFirst.mockResolvedValue({ id: 'run-1' });
        mocks.testRunUpdateMany.mockResolvedValue({ count: 1 });
        mocks.testCaseUpdate.mockResolvedValue({ id: 'tc-1', status: 'CANCELLED' });
        mocks.testRunEventCreateMany.mockResolvedValue({ count: 0 });
        mocks.testRunFileCreate.mockResolvedValue({ id: 'run-file-1' });
        mocks.userFindUnique.mockResolvedValue({ id: 'user-1' });
        mocks.projectFindUnique.mockResolvedValue({ id: 'project-1' });
        mocks.usageRecordUpsert.mockResolvedValue({ id: 'usage-1' });
        mocks.usageRecordCreate.mockResolvedValue({ id: 'usage-1' });
        mocks.txTestRunFindUnique.mockResolvedValue({
            id: 'run-1',
            status: 'RUNNING',
            assignedRunnerId: null,
            leaseExpiresAt: null,
            nextEventSequence: 0,
        });

        mocks.transaction.mockImplementation(async (callback: (tx: {
            testRun: {
                findUnique: typeof mocks.txTestRunFindUnique;
                updateMany: typeof mocks.testRunUpdateMany;
            };
            testRunEvent: { createMany: typeof mocks.testRunEventCreateMany };
        }) => Promise<unknown>) => callback({
            testRun: {
                findUnique: mocks.txTestRunFindUnique,
                updateMany: mocks.testRunUpdateMany,
            },
            testRunEvent: {
                createMany: mocks.testRunEventCreateMany,
            },
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        delete process.env.RUNNER_RUN_STATUS_POLL_INTERVAL_MS;
        delete process.env.RUNNER_RUN_STATUS_MAX_POLL_INTERVAL_MS;
        delete process.env.RUNNER_LEASE_DURATION_SECONDS;
    });

    it('aborts an in-flight local browser run within 1s after cancellation is persisted and reconciled', async () => {
        vi.resetModules();
        const { startLocalBrowserRun, abortInactiveLocalBrowserRuns } = await import('@/lib/runtime/local-browser-runner');

        let persistedStatus: 'RUNNING' | 'CANCELLED' = 'RUNNING';
        mocks.testRunFindMany.mockImplementation(async () => [{
            id: 'run-1',
            status: persistedStatus,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        }]);

        let abortObservedAtMs: number | null = null;
        mocks.runTest.mockImplementation(async (input: {
            signal: AbortSignal;
            onPreparing?: () => Promise<void>;
            onRunning?: () => Promise<void>;
        }) => {
            await input.onPreparing?.();
            await input.onRunning?.();

            await new Promise<void>((resolve) => {
                if (input.signal.aborted) {
                    abortObservedAtMs = Date.now();
                    resolve();
                    return;
                }
                input.signal.addEventListener('abort', () => {
                    abortObservedAtMs = Date.now();
                    resolve();
                }, { once: true });
            });

            return {
                status: 'CANCELLED',
                error: 'Cancelled by user',
            };
        });

        let finished = false;
        const runPromise = startLocalBrowserRun('run-1').then(() => {
            finished = true;
        });

        await vi.advanceTimersByTimeAsync(1);

        const cancellationPersistedAtMs = Date.now();
        persistedStatus = 'CANCELLED';
        const abortedRuns = await abortInactiveLocalBrowserRuns();
        expect(abortedRuns).toBe(1);

        for (let elapsedMs = 0; elapsedMs < 1000 && !finished; elapsedMs += 5) {
            await vi.advanceTimersByTimeAsync(5);
        }
        await runPromise;

        expect(abortObservedAtMs).not.toBeNull();
        const detectionLatencyMs = (abortObservedAtMs ?? cancellationPersistedAtMs) - cancellationPersistedAtMs;
        expect(detectionLatencyMs).toBeLessThanOrEqual(1000);
    });

    it('does not abort an in-flight run when persisted status remains RUNNING', async () => {
        vi.resetModules();
        const { startLocalBrowserRun, abortInactiveLocalBrowserRuns } = await import('@/lib/runtime/local-browser-runner');

        mocks.testRunFindMany.mockResolvedValue([{
            id: 'run-1',
            status: 'RUNNING',
            assignedRunnerId: null,
            leaseExpiresAt: null,
        }]);

        let signalAborted = false;
        mocks.runTest.mockImplementation(async (input: {
            signal: AbortSignal;
            onPreparing?: () => Promise<void>;
            onRunning?: () => Promise<void>;
        }) => {
            await input.onPreparing?.();
            await input.onRunning?.();
            signalAborted = input.signal.aborted;
            await new Promise((resolve) => setTimeout(resolve, 200));
            signalAborted = signalAborted || input.signal.aborted;
            return {
                status: 'PASS',
            };
        });

        const runPromise = startLocalBrowserRun('run-1');
        await vi.advanceTimersByTimeAsync(1);
        const abortedRuns = await abortInactiveLocalBrowserRuns();
        expect(abortedRuns).toBe(0);

        await vi.advanceTimersByTimeAsync(250);
        await runPromise;
        expect(signalAborted).toBe(false);
    });
});

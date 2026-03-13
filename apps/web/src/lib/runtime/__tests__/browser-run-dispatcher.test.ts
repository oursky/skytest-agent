import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_EXECUTION_CAPABILITY } from '@/lib/runners/constants';
import { RUN_IN_PROGRESS_STATUSES, TEST_STATUS } from '@/types';

const { queryRaw, startLocalBrowserRun } = vi.hoisted(() => ({
    queryRaw: vi.fn(),
    startLocalBrowserRun: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        $queryRaw: queryRaw,
    },
}));

vi.mock('@/lib/runtime/local-browser-runner', () => ({
    startLocalBrowserRun,
}));

const {
    dispatchBrowserRun,
    dispatchNextQueuedBrowserRun,
} = await import('@/lib/runtime/browser-run-dispatcher');

describe('browser-run-dispatcher', () => {
    beforeEach(() => {
        queryRaw.mockReset();
        startLocalBrowserRun.mockReset();
        startLocalBrowserRun.mockResolvedValue(undefined);
    });

    it('dispatches next queued browser run when a candidate is claimed', async () => {
        queryRaw.mockResolvedValueOnce([{ id: 'run-browser-1' }]);

        const dispatched = await dispatchNextQueuedBrowserRun();

        expect(dispatched).toBe(true);
        expect(startLocalBrowserRun).toHaveBeenCalledWith('run-browser-1');
        const [query] = queryRaw.mock.calls[0];
        const sql = query.strings.join('');
        expect(sql).toContain('tr."requiredCapability" =');
        expect(sql).toContain('tr.status =');
        expect(query.values).toContain(TEST_STATUS.QUEUED);
        expect(query.values).toContain(BROWSER_EXECUTION_CAPABILITY);
    });

    it('does not dispatch when no queued browser run is claimable', async () => {
        queryRaw.mockResolvedValueOnce([]);

        const dispatched = await dispatchNextQueuedBrowserRun();

        expect(dispatched).toBe(false);
        expect(startLocalBrowserRun).not.toHaveBeenCalled();
    });

    it('filters by run id for targeted browser dispatch', async () => {
        queryRaw.mockResolvedValueOnce([{ id: 'run-browser-2' }]);

        const dispatched = await dispatchBrowserRun('run-browser-2');

        expect(dispatched).toBe(true);
        expect(startLocalBrowserRun).toHaveBeenCalledWith('run-browser-2');
        const [query] = queryRaw.mock.calls[0];
        expect(query.values).toContain('run-browser-2');
    });

    it('uses active-run states for concurrency gating so queued Android runs do not block browser dispatch', async () => {
        queryRaw.mockResolvedValueOnce([{ id: 'run-browser-3' }]);

        const dispatched = await dispatchNextQueuedBrowserRun();

        expect(dispatched).toBe(true);
        const [query] = queryRaw.mock.calls[0];
        const sql = query.strings.join('');
        expect(sql).toContain('activeTr.status IN');
        expect(query.values).toEqual(expect.arrayContaining([...RUN_IN_PROGRESS_STATUSES]));
        const queuedValueCount = query.values.filter((value: unknown) => value === TEST_STATUS.QUEUED).length;
        expect(queuedValueCount).toBe(1);
    });
});

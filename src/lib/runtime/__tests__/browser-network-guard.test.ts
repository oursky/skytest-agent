import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from 'playwright';

const mocks = vi.hoisted(() => ({
    validateRuntimeRequestUrl: vi.fn(),
}));

vi.mock('@/lib/security/url-security-runtime', () => ({
    validateRuntimeRequestUrl: mocks.validateRuntimeRequestUrl,
    DNS_RESOLUTION_FAILED_CODE: 'DNS_RESOLUTION_FAILED',
}));

const { createBrowserNetworkGuard } = await import('@/lib/runtime/browser-network-guard');

function createMockRoute(url: string): {
    route: Route;
    abort: ReturnType<typeof vi.fn>;
    continueRequest: ReturnType<typeof vi.fn>;
} {
    const abort = vi.fn().mockResolvedValue(undefined);
    const continueRequest = vi.fn().mockResolvedValue(undefined);

    const route = {
        request: () => ({ url: () => url }),
        abort,
        continue: continueRequest,
    } as unknown as Route;

    return { route, abort, continueRequest };
}

describe('createBrowserNetworkGuard', () => {
    beforeEach(() => {
        mocks.validateRuntimeRequestUrl.mockReset();
    });

    it('continues allowed requests', async () => {
        mocks.validateRuntimeRequestUrl.mockResolvedValueOnce({ valid: true });
        const logs: string[] = [];
        const guard = createBrowserNetworkGuard({
            targetId: 'browser_a',
            targetLabel: 'BROWSER A',
            log: (message) => {
                logs.push(message);
            },
        });
        const { route, abort, continueRequest } = createMockRoute('https://example.com/app');

        await guard.handleRoute(route);

        expect(continueRequest).toHaveBeenCalledTimes(1);
        expect(abort).not.toHaveBeenCalled();
        expect(logs).toEqual([]);
        expect(guard.getSummary().blockedRequestCount).toBe(0);
    });

    it('aborts blocked requests and emits deduplicated log entries', async () => {
        mocks.validateRuntimeRequestUrl.mockResolvedValue({
            valid: false,
            error: 'DNS lookup failed',
            code: 'DNS_RESOLUTION_FAILED'
        });

        const logs: string[] = [];
        const guard = createBrowserNetworkGuard({
            targetId: 'browser_a',
            targetLabel: 'BROWSER A',
            log: (message) => {
                logs.push(message);
            },
        });

        const first = createMockRoute('https://example.com/app.js');
        const second = createMockRoute('https://example.com/chunk.js');

        await guard.handleRoute(first.route);
        await guard.handleRoute(second.route);

        expect(first.abort).toHaveBeenCalledWith('blockedbyclient');
        expect(second.abort).toHaveBeenCalledWith('blockedbyclient');
        expect(logs).toHaveLength(1);

        expect(guard.getSummary()).toEqual({
            targetId: 'browser_a',
            blockedRequestCount: 2,
            dnsLookupFailureCount: 2,
            blockedByCode: {
                DNS_RESOLUTION_FAILED: 2,
            },
            blockedByReason: {
                'DNS lookup failed': 2,
            },
            blockedByHostname: {
                'example.com': 2,
            },
        });
    });

    it('aborts immediately when run is cancelled', async () => {
        const controller = new AbortController();
        controller.abort();

        const guard = createBrowserNetworkGuard({
            targetId: 'browser_a',
            targetLabel: 'BROWSER A',
            signal: controller.signal,
            log: () => { },
        });
        const { route, abort, continueRequest } = createMockRoute('https://example.com/app');

        await guard.handleRoute(route);

        expect(abort).toHaveBeenCalledWith('aborted');
        expect(continueRequest).not.toHaveBeenCalled();
        expect(mocks.validateRuntimeRequestUrl).not.toHaveBeenCalled();
    });
});

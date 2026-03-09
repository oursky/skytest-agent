import type { Route } from 'playwright';
import { config } from '@/config/app';
import { validateRuntimeRequestUrl } from '@/lib/security/url-security-runtime';

interface BrowserNetworkGuardLog {
    (message: string, level: 'info' | 'error' | 'success', browserId?: string): void;
}

export interface BrowserNetworkGuardSummary {
    targetId: string;
    blockedRequestCount: number;
    dnsLookupFailureCount: number;
    blockedByReason: Record<string, number>;
    blockedByHostname: Record<string, number>;
}

export interface BrowserNetworkGuard {
    handleRoute(route: Route): Promise<void>;
    getSummary(): BrowserNetworkGuardSummary;
}

interface BrowserNetworkGuardOptions {
    targetId: string;
    targetLabel: string;
    log: BrowserNetworkGuardLog;
    signal?: AbortSignal;
}

const DNS_LOOKUP_FAILED_ERROR = 'DNS lookup failed';

function incrementCounter(counter: Map<string, number>, key: string): void {
    counter.set(key, (counter.get(key) ?? 0) + 1);
}

function toSortedRecord(counter: Map<string, number>): Record<string, number> {
    return Object.fromEntries(
        Array.from(counter.entries()).sort(([a], [b]) => a.localeCompare(b))
    );
}

export function createBrowserNetworkGuard(options: BrowserNetworkGuardOptions): BrowserNetworkGuard {
    const blockedRequestLogDedup = new Map<string, number>();
    const blockedByReason = new Map<string, number>();
    const blockedByHostname = new Map<string, number>();
    let blockedRequestCount = 0;
    let dnsLookupFailureCount = 0;

    return {
        async handleRoute(route: Route): Promise<void> {
            if (options.signal?.aborted) {
                await route.abort('aborted');
                return;
            }

            const requestUrl = route.request().url();
            const validation = await validateRuntimeRequestUrl(requestUrl);
            if (validation.valid) {
                await route.continue();
                return;
            }

            blockedRequestCount += 1;
            const reason = validation.error ?? 'not allowed';
            if (reason === DNS_LOOKUP_FAILED_ERROR) {
                dnsLookupFailureCount += 1;
            }
            incrementCounter(blockedByReason, reason);

            let hostname = 'unknown-host';
            try {
                hostname = new URL(requestUrl).hostname;
            } catch {
                hostname = 'invalid-url';
            }
            incrementCounter(blockedByHostname, hostname);

            const dedupKey = `${hostname}:${reason}`;
            const now = Date.now();
            const lastLoggedAt = blockedRequestLogDedup.get(dedupKey) ?? 0;
            if (now - lastLoggedAt > config.test.security.blockedRequestLogDedupMs) {
                blockedRequestLogDedup.set(dedupKey, now);
                options.log(
                    `[${options.targetLabel}] Blocked request to ${hostname}: ${reason}`,
                    'error',
                    options.targetId
                );
            }

            await route.abort('blockedbyclient');
        },
        getSummary(): BrowserNetworkGuardSummary {
            return {
                targetId: options.targetId,
                blockedRequestCount,
                dnsLookupFailureCount,
                blockedByReason: toSortedRecord(blockedByReason),
                blockedByHostname: toSortedRecord(blockedByHostname),
            };
        },
    };
}

import type { BrowserNetworkGuardSummary } from '@/lib/runtime/browser-network-guard';

type BrowserNetworkGuardLike = {
    getSummary(): BrowserNetworkGuardSummary;
};

type RuntimeLog = (message: string, level?: 'info' | 'error' | 'success', browserId?: string) => void;

export function collectBrowserNetworkGuardSummaries(
    browserNetworkGuards: Map<string, BrowserNetworkGuardLike>
): BrowserNetworkGuardSummary[] {
    return Array.from(browserNetworkGuards.values(), (networkGuard) => networkGuard.getSummary());
}

export function emitBrowserNetworkGuardSummaries(input: {
    browserNetworkGuards: Map<string, BrowserNetworkGuardLike>;
    log: RuntimeLog;
    getBrowserNiceName: (browserId: string) => string;
}): void {
    const { browserNetworkGuards, log, getBrowserNiceName } = input;

    for (const [browserId, summary] of Array.from(browserNetworkGuards.entries(), ([id, guard]) => [id, guard.getSummary()] as const)) {
        if (summary.blockedRequestCount === 0) {
            continue;
        }

        const targetLabel = getBrowserNiceName(browserId);
        const level = summary.dnsLookupFailureCount > 0 ? 'error' : 'info';

        log(
            `[${targetLabel}] Network guard summary: ${JSON.stringify({
                blockedRequestCount: summary.blockedRequestCount,
                dnsLookupFailureCount: summary.dnsLookupFailureCount,
                blockedByCode: summary.blockedByCode,
                blockedByReason: summary.blockedByReason,
                blockedByHostname: summary.blockedByHostname,
            })}`,
            level,
            browserId
        );
    }
}

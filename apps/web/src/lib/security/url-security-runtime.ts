import { config } from '@/config/app';
import { isBlockedIpAddress, normalizeIpHostname, UrlValidationResult, validateTargetUrl } from '@/lib/security/url-security';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

interface HostnameDnsCacheEntry {
    expiresAt: number;
    result: UrlValidationResult;
}

const hostnameDnsCache = new Map<string, HostnameDnsCacheEntry>();
const hostnamePinnedAddresses = new Map<string, Set<string>>();
const hostnamePinnedCheckAt = new Map<string, number>();
const PINNED_DNS_RECHECK_INTERVAL_MS = 5000;
export const DNS_RESOLUTION_FAILED_CODE = 'DNS_RESOLUTION_FAILED';
export const DNS_NO_ADDRESSES_CODE = 'DNS_NO_ADDRESSES';
export const PRIVATE_NETWORK_BLOCKED_CODE = 'PRIVATE_NETWORK_BLOCKED';
export const DNS_REBINDING_DETECTED_CODE = 'DNS_REBINDING_DETECTED';

function createUrlValidationFailure(error: string, code: string): UrlValidationResult {
    return { valid: false, error, code };
}

function getCachedHostnameResult(hostname: string): UrlValidationResult | null {
    const entry = hostnameDnsCache.get(hostname);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        hostnameDnsCache.delete(hostname);
        return null;
    }
    return entry.result;
}

function setCachedHostnameResult(hostname: string, result: UrlValidationResult): void {
    hostnameDnsCache.set(hostname, {
        expiresAt: Date.now() + config.test.security.dnsCacheTtlMs,
        result
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dnsLookupAllOnce(hostname: string): Promise<string[]> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), config.test.security.dnsLookupTimeoutMs);
    });

    try {
        const results = await Promise.race([
            lookup(hostname, { all: true, verbatim: true }),
            timeoutPromise
        ]);

        return results.map((r) => r.address);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

async function dnsLookupAll(hostname: string): Promise<string[]> {
    const maxAttempts = Math.max(1, config.test.security.dnsLookupRetryAttempts);
    const retryDelayMs = Math.max(0, config.test.security.dnsLookupRetryDelayMs);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await dnsLookupAllOnce(hostname);
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts && retryDelayMs > 0) {
                await sleep(retryDelayMs * attempt);
            }
        }
    }

    throw lastError ?? new Error('DNS lookup failed');
}

function normalizeResolvedAddresses(addresses: string[]): string[] {
    return Array.from(new Set(addresses.map((address) => normalizeIpHostname(address))))
        .filter((address) => address.length > 0)
        .sort((a, b) => a.localeCompare(b));
}

export async function validateRuntimeRequestUrl(rawUrl: string): Promise<UrlValidationResult> {
    const base = validateTargetUrl(rawUrl);
    if (!base.valid) return base;

    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }

    const hostname = url.hostname.toLowerCase();
    if (!hostname) {
        return { valid: false, error: 'URL hostname is required' };
    }
    const normalizedHostname = normalizeIpHostname(hostname);

    const ipVersion = isIP(normalizedHostname);
    if (ipVersion === 4 || ipVersion === 6) {
        return isBlockedIpAddress(normalizedHostname)
            ? createUrlValidationFailure('Private network addresses are not allowed', PRIVATE_NETWORK_BLOCKED_CODE)
            : { valid: true };
    }

    const now = Date.now();
    const pinned = hostnamePinnedAddresses.get(normalizedHostname);
    const lastPinnedCheckAt = hostnamePinnedCheckAt.get(normalizedHostname) ?? 0;
    const requiresPinnedRecheck = Boolean(pinned) && (now - lastPinnedCheckAt >= PINNED_DNS_RECHECK_INTERVAL_MS);
    const cached = getCachedHostnameResult(hostname);
    if (cached && !requiresPinnedRecheck) return cached;

    try {
        const addresses = normalizeResolvedAddresses(await dnsLookupAll(hostname));
        if (addresses.length === 0) {
            const result = createUrlValidationFailure('DNS lookup returned no addresses', DNS_NO_ADDRESSES_CODE);
            setCachedHostnameResult(hostname, result);
            return result;
        }

        if (addresses.some((address) => isBlockedIpAddress(address))) {
            const result = createUrlValidationFailure('Private network addresses are not allowed', PRIVATE_NETWORK_BLOCKED_CODE);
            setCachedHostnameResult(hostname, result);
            return result;
        }

        if (pinned) {
            const hasUnexpectedAddress = addresses.some((address) => !pinned.has(address));
            if (hasUnexpectedAddress) {
                const result = createUrlValidationFailure(
                    'DNS rebinding detected',
                    DNS_REBINDING_DETECTED_CODE
                );
                setCachedHostnameResult(hostname, result);
                return result;
            }
        } else {
            hostnamePinnedAddresses.set(normalizedHostname, new Set(addresses));
        }

        hostnamePinnedCheckAt.set(normalizedHostname, now);
        const result = { valid: true };
        setCachedHostnameResult(hostname, result);
        return result;
    } catch {
        const result = createUrlValidationFailure('DNS lookup failed', DNS_RESOLUTION_FAILED_CODE);
        setCachedHostnameResult(hostname, result);
        return result;
    }
}

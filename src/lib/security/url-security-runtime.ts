import { config } from '@/config/app';
import { isBlockedIpAddress, UrlValidationResult, validateTargetUrl } from '@/lib/security/url-security';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

interface HostnameDnsCacheEntry {
    expiresAt: number;
    result: UrlValidationResult;
}

const hostnameDnsCache = new Map<string, HostnameDnsCacheEntry>();
export const DNS_RESOLUTION_FAILED_CODE = 'DNS_RESOLUTION_FAILED';
export const DNS_NO_ADDRESSES_CODE = 'DNS_NO_ADDRESSES';
export const PRIVATE_NETWORK_BLOCKED_CODE = 'PRIVATE_NETWORK_BLOCKED';

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

    const ipVersion = isIP(hostname);
    if (ipVersion === 4 || ipVersion === 6) {
        return isBlockedIpAddress(hostname)
            ? createUrlValidationFailure('Private network addresses are not allowed', PRIVATE_NETWORK_BLOCKED_CODE)
            : { valid: true };
    }

    const cached = getCachedHostnameResult(hostname);
    if (cached) return cached;

    try {
        const addresses = await dnsLookupAll(hostname);
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

        const result = { valid: true };
        setCachedHostnameResult(hostname, result);
        return result;
    } catch {
        const result = createUrlValidationFailure('DNS lookup failed', DNS_RESOLUTION_FAILED_CODE);
        setCachedHostnameResult(hostname, result);
        return result;
    }
}

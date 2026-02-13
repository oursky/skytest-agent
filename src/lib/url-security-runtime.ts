import { config } from '@/config/app';
import { isBlockedIpAddress, UrlValidationResult, validateTargetUrl } from './url-security';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

interface HostnameDnsCacheEntry {
    expiresAt: number;
    valid: boolean;
    error?: string;
}

const hostnameDnsCache = new Map<string, HostnameDnsCacheEntry>();

function getCachedHostnameResult(hostname: string): UrlValidationResult | null {
    const entry = hostnameDnsCache.get(hostname);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        hostnameDnsCache.delete(hostname);
        return null;
    }
    if (entry.valid) {
        hostnameDnsCache.delete(hostname);
        return null;
    }
    return entry.valid ? { valid: true } : { valid: false, error: entry.error };
}

function setCachedHostnameResult(hostname: string, result: UrlValidationResult): void {
    hostnameDnsCache.set(hostname, {
        expiresAt: Date.now() + config.test.security.dnsCacheTtlMs,
        valid: result.valid,
        error: result.error
    });
}

async function dnsLookupAll(hostname: string): Promise<string[]> {
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
            ? { valid: false, error: 'Private network addresses are not allowed' }
            : { valid: true };
    }

    const cached = getCachedHostnameResult(hostname);
    if (cached) return cached;

    try {
        const addresses = await dnsLookupAll(hostname);
        if (addresses.length === 0) {
            const result = { valid: false, error: 'DNS lookup returned no addresses' };
            setCachedHostnameResult(hostname, result);
            return result;
        }

        if (addresses.some((address) => isBlockedIpAddress(address))) {
            const result = { valid: false, error: 'Private network addresses are not allowed' };
            setCachedHostnameResult(hostname, result);
            return result;
        }

        return { valid: true };
    } catch {
        const result = { valid: false, error: 'DNS lookup failed' };
        setCachedHostnameResult(hostname, result);
        return result;
    }
}

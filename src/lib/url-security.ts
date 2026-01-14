import { config } from '@/config/app';
import { isIP } from 'node:net';

export interface UrlValidationResult {
    valid: boolean;
    error?: string;
}

interface CidrRange {
    base: number;
    mask: number;
}

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return null;
    }
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function cidrToRange(cidr: string): CidrRange | null {
    const [base, bits] = cidr.split('/');
    const baseInt = ipv4ToInt(base);
    const maskBits = Number(bits);
    if (baseInt === null || Number.isNaN(maskBits) || maskBits < 0 || maskBits > 32) {
        return null;
    }
    const mask = maskBits === 0 ? 0 : 0xffffffff << (32 - maskBits);
    return { base: baseInt, mask: mask >>> 0 };
}

function isIpv4Blocked(ip: string): boolean {
    const ipInt = ipv4ToInt(ip);
    if (ipInt === null) return false;

    for (const cidr of config.test.security.blockedIpv4Cidrs) {
        const range = cidrToRange(cidr);
        if (!range) continue;
        if ((ipInt & range.mask) === (range.base & range.mask)) {
            return true;
        }
    }

    return false;
}

function isIpv6Blocked(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return config.test.security.blockedIpv6Prefixes.some((prefix) => normalized.startsWith(prefix));
}

export function validateTargetUrl(rawUrl: string): UrlValidationResult {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }

    if (!config.test.security.allowedUrlProtocols.includes(url.protocol)) {
        return { valid: false, error: 'Only http and https URLs are allowed' };
    }

    if (url.username || url.password) {
        return { valid: false, error: 'Credentials in URL are not allowed' };
    }

    const hostname = url.hostname.toLowerCase();
    if (!hostname) {
        return { valid: false, error: 'URL hostname is required' };
    }

    if (config.test.security.blockedHostnames.includes(hostname)) {
        return { valid: false, error: 'Target host is not allowed' };
    }

    if (config.test.security.blockedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))) {
        return { valid: false, error: 'Target host is not allowed' };
    }

    const ipVersion = isIP(hostname);
    if (ipVersion === 4 && isIpv4Blocked(hostname)) {
        return { valid: false, error: 'Private network addresses are not allowed' };
    }

    if (ipVersion === 6 && isIpv6Blocked(hostname)) {
        return { valid: false, error: 'Private network addresses are not allowed' };
    }

    return { valid: true };
}

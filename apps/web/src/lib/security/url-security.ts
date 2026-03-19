import { config } from '@/config/app';
import { isIP } from 'node:net';

export interface UrlValidationResult {
    valid: boolean;
    error?: string;
    code?: string;
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

export function normalizeIpHostname(hostname: string): string {
    const lower = hostname.trim().toLowerCase();
    const withoutBrackets = lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;
    const zoneIndex = withoutBrackets.indexOf('%');
    return zoneIndex >= 0 ? withoutBrackets.slice(0, zoneIndex) : withoutBrackets;
}

function parseIpv4FromMappedIpv6(hostname: string): string | null {
    const normalized = normalizeIpHostname(hostname);
    if (!normalized.startsWith('::ffff:')) {
        return null;
    }

    const mapped = normalized.slice('::ffff:'.length);
    if (isIP(mapped) === 4) {
        return mapped;
    }

    const hextets = mapped.split(':');
    if (hextets.length !== 2) {
        return null;
    }

    const values = hextets.map((part) => Number.parseInt(part, 16));
    if (values.some((value) => Number.isNaN(value) || value < 0 || value > 0xffff)) {
        return null;
    }

    const [high, low] = values;
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

export function isBlockedIpAddress(hostname: string): boolean {
    const normalizedHostname = normalizeIpHostname(hostname);
    const mappedIpv4 = parseIpv4FromMappedIpv6(normalizedHostname);
    if (mappedIpv4) {
        return isIpv4Blocked(mappedIpv4);
    }

    const ipVersion = isIP(normalizedHostname);
    if (ipVersion === 4) return isIpv4Blocked(normalizedHostname);
    if (ipVersion === 6) return isIpv6Blocked(normalizedHostname);
    return false;
}

export function validateTargetUrl(rawUrl: string): UrlValidationResult {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }

    if (!config.test.security.allowedUrlProtocols.includes(
        url.protocol as (typeof config.test.security.allowedUrlProtocols)[number]
    )) {
        return { valid: false, error: 'Only http and https URLs are allowed' };
    }

    if (url.username || url.password) {
        return { valid: false, error: 'Credentials in URL are not allowed' };
    }

    const hostname = url.hostname.toLowerCase();
    if (!hostname) {
        return { valid: false, error: 'URL hostname is required' };
    }

    if (config.test.security.blockedHostnames.includes(
        hostname as (typeof config.test.security.blockedHostnames)[number]
    )) {
        return { valid: false, error: 'Target host is not allowed' };
    }

    if (config.test.security.blockedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))) {
        return { valid: false, error: 'Target host is not allowed' };
    }

    if (isBlockedIpAddress(hostname)) {
        return { valid: false, error: 'Private network addresses are not allowed' };
    }

    return { valid: true };
}

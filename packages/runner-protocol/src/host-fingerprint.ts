import crypto from 'node:crypto';
import os from 'node:os';

export function resolveHostFingerprint(configuredHostFingerprint?: string | null): string {
    const configured = configuredHostFingerprint?.trim();
    if (configured) {
        return configured;
    }

    const interfaces = os.networkInterfaces();
    const macs = Object.values(interfaces)
        .flatMap((items) => items ?? [])
        .map((entry) => entry.mac?.trim().toLowerCase() ?? '')
        .filter((mac) => mac.length > 0 && mac !== '00:00:00:00:00:00')
        .sort();
    const host = os.hostname().trim().toLowerCase() || 'host';
    const digest = crypto
        .createHash('sha256')
        .update(JSON.stringify({ host, macs }))
        .digest('hex');
    return `host-${digest.slice(0, 40)}`;
}

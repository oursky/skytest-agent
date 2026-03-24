export function resolveConsoleAppVersion(rawVersion: string | undefined, hostname: string | undefined): string {
    const version = rawVersion?.trim();
    if (version && version.length > 0) {
        return version;
    }

    const normalizedHostname = hostname?.trim().toLowerCase();
    if (normalizedHostname === 'localhost'
        || normalizedHostname?.endsWith('.localhost')
        || normalizedHostname === '127.0.0.1'
        || normalizedHostname === '::1'
        || normalizedHostname === '[::1]'
    ) {
        return 'local-dev';
    }

    return 'unknown';
}

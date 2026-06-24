/**
 * Human-friendly label for an execution target id shown in run logs and the results
 * viewer. The shared session browser (`session_main`, used for login-flow prefixes) and
 * the legacy single target (`main`) read as "Browser"; per-target ids read as
 * "Browser A" / "Android C". Anything unrecognized falls back to the raw id.
 *
 * Not localized: this label is emitted server-side into persisted run-event log lines
 * (which have no user locale) as well as the client log view, so it stays a stable
 * technical token rather than a per-locale string.
 */
export function browserTargetLabel(browserId: string | null | undefined): string {
    if (!browserId || browserId === 'main' || browserId === 'session_main') {
        return 'Browser';
    }
    if (browserId.startsWith('browser_')) {
        return `Browser ${browserId.slice('browser_'.length).toUpperCase()}`;
    }
    if (browserId.startsWith('android_')) {
        return `Android ${browserId.slice('android_'.length).toUpperCase()}`;
    }
    return browserId;
}

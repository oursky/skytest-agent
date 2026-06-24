function toUnixTimestampSeconds(date: Date): number {
    return Math.floor(date.getTime() / 1000);
}

function formatFallbackDate(date: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
    }).format(date);
}

export function buildRunUrl(input: {
    appBaseUrl: string | null;
    testCaseId: string;
    runId: string;
}): string | null {
    if (!input.appBaseUrl) {
        return null;
    }

    const baseUrl = input.appBaseUrl.trim();
    if (!baseUrl) {
        return null;
    }

    return `${baseUrl.replace(/\/+$/, '')}/test-cases/${encodeURIComponent(input.testCaseId)}/history/${encodeURIComponent(input.runId)}`;
}

export function buildTestGroupUrl(input: {
    appBaseUrl: string | null;
    projectId: string;
    sessionId: string;
}): string | null {
    if (!input.appBaseUrl) {
        return null;
    }
    const baseUrl = input.appBaseUrl.trim();
    if (!baseUrl) {
        return null;
    }
    return `${baseUrl.replace(/\/+$/, '')}/test-groups/runs/${encodeURIComponent(input.sessionId)}?projectId=${encodeURIComponent(input.projectId)}`;
}

export function formatSlackDateToken(date: Date | null): string {
    if (!date) {
        return '-';
    }

    const timestamp = toUnixTimestampSeconds(date);
    const fallback = formatFallbackDate(date);
    return `<!date^${timestamp}^{date_num} {time_secs}|${fallback} UTC>`;
}

export function resolveSlackAppBaseUrlFromEnv(): string | null {
    const skytestBaseUrl = process.env.SKYTEST_BASE_URL?.trim();
    if (skytestBaseUrl) {
        return skytestBaseUrl;
    }

    const authgearRedirectUri = process.env.AUTHGEAR_REDIRECT_URI?.trim();
    if (!authgearRedirectUri) {
        return null;
    }

    try {
        return new URL(authgearRedirectUri).origin;
    } catch {
        return null;
    }
}

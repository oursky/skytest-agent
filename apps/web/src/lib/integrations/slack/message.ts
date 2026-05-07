import { TEST_STATUS } from '@/types';

type SlackRunMessageStatus = typeof TEST_STATUS.FAIL | typeof TEST_STATUS.PASS;

interface BuildSlackRunMessageInput {
    status: SlackRunMessageStatus;
    testCaseDisplayId: string;
    testCaseName: string;
    testCaseId: string;
    runId: string;
    startedAt: Date | null;
    completedAt: Date | null;
    errorSummary: string;
    durationSeconds: number;
    appBaseUrl: string | null;
}

function escapeSlackMrkdwnValue(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

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

function formatRunLabel(date: Date | null): string {
    if (!date) {
        return 'Run';
    }

    return `Run - ${formatFallbackDate(date)}`;
}

function buildRunUrl(input: {
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

export function buildSlackRunReference(input: {
    runUrl: string | null;
    startedAt: Date | null;
}): string {
    if (!input.startedAt) {
        return input.runUrl ? `<${input.runUrl}|Run>` : 'Run';
    }

    const timestamp = toUnixTimestampSeconds(input.startedAt);
    const fallback = `${formatRunLabel(input.startedAt)} UTC`;
    if (input.runUrl) {
        return `<!date^${timestamp}^Run - {date_short} {time}^${input.runUrl}|${fallback}>`;
    }

    return `<!date^${timestamp}^Run - {date_short} {time}|${fallback}>`;
}

export function formatSlackDateToken(date: Date | null): string {
    if (!date) {
        return '-';
    }

    const timestamp = toUnixTimestampSeconds(date);
    const fallback = formatFallbackDate(date);
    return `<!date^${timestamp}^{date_short} {time}|${fallback} UTC>`;
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

export function buildSlackRunMessage(input: BuildSlackRunMessageInput): string {
    const runUrl = buildRunUrl({
        appBaseUrl: input.appBaseUrl,
        testCaseId: input.testCaseId,
        runId: input.runId,
    });
    const header = input.status === TEST_STATUS.FAIL ? '*Test failed*' : '*Test passed*';
    const lines = [
        `${header} ${escapeSlackMrkdwnValue(input.testCaseDisplayId)}`,
        `*Test Case:* ${escapeSlackMrkdwnValue(input.testCaseName)}`,
        `*Run ID:* ${buildSlackRunReference({ runUrl, startedAt: input.startedAt })}`,
        `*Started:* ${formatSlackDateToken(input.startedAt)}  *Completed:* ${formatSlackDateToken(input.completedAt)}`,
        input.status === TEST_STATUS.FAIL
            ? `*Error:* ${escapeSlackMrkdwnValue(input.errorSummary)}`
            : `*Duration:* ${input.durationSeconds}s`,
    ];

    return lines.join('\n');
}

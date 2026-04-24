import {
    isRunTerminalStatus,
    type ConfigItem,
    type BrowserConfig,
    type RunActiveStatus,
    type RunTerminalStatus,
    type TestEvent,
    type TestFailureCategory,
    type TestFailureCode,
    type TestStep,
    type TargetConfig,
} from '@/types';

export type RunViewerStatus = RunActiveStatus | RunTerminalStatus;

export interface RunViewerResult {
    status: RunViewerStatus | null;
    events: TestEvent[];
    error?: string;
    errorCode?: TestFailureCode;
    errorCategory?: TestFailureCategory;
}

export interface RunDetailSnapshot {
    status?: RunViewerStatus | null;
    events?: TestEvent[];
    error?: string | null;
    errorCode?: TestFailureCode | null;
    errorCategory?: TestFailureCategory | null;
}

export interface RunStreamStatusUpdate {
    type: 'status';
    status: RunViewerStatus;
    error?: string;
    errorCode?: TestFailureCode;
    errorCategory?: TestFailureCategory;
}

export interface RunStreamUpdateResult {
    next: RunViewerResult;
    shouldStopLoading: boolean;
}

export interface RunFormData {
    url: string;
    prompt: string;
    name?: string;
    displayId?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
    for (const value of values) {
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

export function mergeRunFormData(input: {
    snapshot?: Partial<RunFormData> | null;
    fallback?: Partial<RunFormData> | null;
    previous?: Partial<RunFormData> | null;
}): RunFormData {
    const snapshot = input.snapshot ?? undefined;
    const fallback = input.fallback ?? undefined;
    const previous = input.previous ?? undefined;

    return {
        url: firstDefined(snapshot?.url, fallback?.url, previous?.url, '') ?? '',
        prompt: firstDefined(snapshot?.prompt, fallback?.prompt, previous?.prompt, '') ?? '',
        name: firstDefined(snapshot?.name, fallback?.name, previous?.name),
        displayId: firstDefined(snapshot?.displayId, fallback?.displayId, previous?.displayId),
        steps: firstDefined(snapshot?.steps, fallback?.steps, previous?.steps),
        browserConfig: firstDefined(snapshot?.browserConfig, fallback?.browserConfig, previous?.browserConfig),
    };
}

export function applyRunStreamStatusUpdate(
    previous: RunViewerResult,
    update: RunStreamStatusUpdate
): RunStreamUpdateResult {
    const shouldStopLoading = isRunTerminalStatus(update.status);
    return {
        next: {
            ...previous,
            status: update.status,
            error: update.error,
            errorCode: update.errorCode,
            errorCategory: update.errorCategory,
        },
        shouldStopLoading,
    };
}

export function appendRunStreamEvent(
    previous: RunViewerResult,
    event: TestEvent
): RunViewerResult {
    return {
        ...previous,
        events: [...previous.events, event],
    };
}

export function runDetailSnapshotToResult(snapshot: RunDetailSnapshot): RunViewerResult {
    return {
        status: snapshot.status ?? null,
        events: snapshot.events ?? [],
        error: snapshot.error ?? undefined,
        errorCode: snapshot.errorCode ?? undefined,
        errorCategory: snapshot.errorCategory ?? undefined,
    };
}

export function buildEventKey(event: TestEvent): string {
    const browserId = event.browserId || '';
    return `${event.type}|${event.timestamp}|${browserId}|${JSON.stringify(event.data)}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
}

export function extractFileName(headerValue: string | null, fallbackName: string): string {
    if (!headerValue) return fallbackName;
    const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        return decodeURIComponent(utf8Match[1]);
    }
    const quotedMatch = headerValue.match(/filename="([^"]+)"/i);
    if (quotedMatch?.[1]) {
        return quotedMatch[1];
    }
    const plainMatch = headerValue.match(/filename=([^;]+)/i);
    if (plainMatch?.[1]) {
        return plainMatch[1].trim();
    }
    return fallbackName;
}

export function buildExcelBaseName(testCaseIdentifier?: string, testCaseName?: string): string {
    const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeId = sanitize((testCaseIdentifier || '').trim());
    const safeName = sanitize((testCaseName || '').trim());
    if (safeId && safeName) return `${safeId}_${safeName}`;
    if (safeName) return safeName;
    if (safeId) return safeId;
    return 'test_case';
}

export function isExcelFilename(filename: string): boolean {
    const normalized = filename.toLowerCase();
    return normalized.endsWith('.xlsx');
}

export function isSupportedVariableConfig(
    config: ConfigItem
): config is ConfigItem & { type: 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING' | 'FILE' } {
    return config.type === 'URL' || config.type === 'APP_ID' || config.type === 'VARIABLE' || config.type === 'RANDOM_STRING' || config.type === 'FILE';
}

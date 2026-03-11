export type TestEventType = 'log' | 'screenshot';
export type LogLevel = 'info' | 'error' | 'success';

export interface LogData {
    message: string;
    level: LogLevel;
}

export interface ScreenshotData {
    src: string;
    label: string;
}

export interface TestEvent {
    type: TestEventType;
    data: LogData | ScreenshotData;
    timestamp: number;
    browserId?: string;
}

export function isLogData(data: unknown): data is LogData {
    return (
        typeof data === 'object' &&
        data !== null &&
        'message' in data &&
        typeof (data as LogData).message === 'string' &&
        'level' in data &&
        typeof (data as LogData).level === 'string'
    );
}

export function isScreenshotData(data: unknown): data is ScreenshotData {
    return (
        typeof data === 'object' &&
        data !== null &&
        'src' in data &&
        typeof (data as ScreenshotData).src === 'string'
    );
}

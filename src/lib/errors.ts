export class TestExecutionError extends Error {
    constructor(
        message: string,
        public readonly runId: string,
        public readonly step?: string
    ) {
        super(message);
        this.name = 'TestExecutionError';
        Object.setPrototypeOf(this, TestExecutionError.prototype);
    }
}

export class ConfigurationError extends Error {
    constructor(
        message: string,
        public readonly field?: string
    ) {
        super(message);
        this.name = 'ConfigurationError';
        Object.setPrototypeOf(this, ConfigurationError.prototype);
    }
}

export class PlaywrightCodeError extends Error {
    constructor(
        message: string,
        public readonly stepIndex: number,
        public readonly code: string,
        public readonly originalError?: Error
    ) {
        super(message);
        this.name = 'PlaywrightCodeError';
        Object.setPrototypeOf(this, PlaywrightCodeError.prototype);
    }
}

export function getErrorMessage(error: unknown): string {
    const errorString = String(error);

    if (errorString && !errorString.includes('[object Object]')) {
        return errorString.replace(/^Error:\s*/, '');
    }

    if (error instanceof Error) {
        const midsceneError = error as Error & { reason?: string };
        if (midsceneError.reason) {
            return `${error.message}\nReason: ${midsceneError.reason}`;
        }
        return error.message;
    }

    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as { message: unknown }).message);
    }

    return errorString;
}

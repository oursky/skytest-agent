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

export class QueueError extends Error {
    constructor(
        message: string,
        public readonly runId: string,
        public readonly operation: string
    ) {
        super(message);
        this.name = 'QueueError';
        Object.setPrototypeOf(this, QueueError.prototype);
    }
}

export class BrowserError extends Error {
    constructor(
        message: string,
        public readonly browserId?: string
    ) {
        super(message);
        this.name = 'BrowserError';
        Object.setPrototypeOf(this, BrowserError.prototype);
    }
}

export class DatabaseError extends Error {
    constructor(
        message: string,
        public readonly operation: string,
        public readonly model?: string
    ) {
        super(message);
        this.name = 'DatabaseError';
        Object.setPrototypeOf(this, DatabaseError.prototype);
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

export function isTestExecutionError(error: unknown): error is TestExecutionError {
    return error instanceof TestExecutionError;
}

export function isConfigurationError(error: unknown): error is ConfigurationError {
    return error instanceof ConfigurationError;
}

export function isQueueError(error: unknown): error is QueueError {
    return error instanceof QueueError;
}

export function isBrowserError(error: unknown): error is BrowserError {
    return error instanceof BrowserError;
}

export function isDatabaseError(error: unknown): error is DatabaseError {
    return error instanceof DatabaseError;
}

export function isPlaywrightCodeError(error: unknown): error is PlaywrightCodeError {
    return error instanceof PlaywrightCodeError;
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

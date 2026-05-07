export class SlackApiError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;

    constructor(message: string, input: {
        code: string;
        status: number;
        retryable: boolean;
    }) {
        super(message);
        this.name = 'SlackApiError';
        this.code = input.code;
        this.status = input.status;
        this.retryable = input.retryable;
    }
}

export class SlackAuthError extends SlackApiError {
    constructor(message: string, input: { code: string; status: number }) {
        super(message, { ...input, retryable: false });
        this.name = 'SlackAuthError';
    }
}

export class SlackChannelNotFoundError extends SlackApiError {
    constructor(message: string, input: { code: string; status: number }) {
        super(message, { ...input, retryable: false });
        this.name = 'SlackChannelNotFoundError';
    }
}

export class SlackRateLimitError extends SlackApiError {
    readonly retryAfterMs: number;

    constructor(message: string, input: { code: string; status: number; retryAfterMs: number }) {
        super(message, { ...input, retryable: true });
        this.name = 'SlackRateLimitError';
        this.retryAfterMs = input.retryAfterMs;
    }
}

export class SlackTransientError extends SlackApiError {
    constructor(message: string, input: { code: string; status: number }) {
        super(message, { ...input, retryable: true });
        this.name = 'SlackTransientError';
    }
}

export function isSlackAuthErrorCode(code: string): boolean {
    return code === 'invalid_auth'
        || code === 'account_inactive'
        || code === 'token_revoked'
        || code === 'not_authed';
}

export function isSlackChannelErrorCode(code: string): boolean {
    return code === 'channel_not_found' || code === 'not_in_channel';
}

export function isSlackRetryableErrorCode(code: string): boolean {
    return code === 'ratelimited'
        || code === 'internal_error'
        || code === 'fatal_error'
        || code === 'request_timeout'
        || code === 'service_unavailable'
        || code === 'temporarily_unavailable';
}

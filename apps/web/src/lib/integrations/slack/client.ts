import {
    isSlackAuthErrorCode,
    isSlackChannelErrorCode,
    isSlackRetryableErrorCode,
    SlackApiError,
    SlackAuthError,
    SlackChannelNotFoundError,
    SlackRateLimitError,
    SlackTransientError,
} from '@/lib/integrations/slack/errors';

const SLACK_API_BASE_URL = 'https://slack.com/api/';
const SLACK_CONNECT_TIMEOUT_MS = 5_000;
const SLACK_TOTAL_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;
const CONNECT_ABORT_REASON = 'connect_timeout';
const TOTAL_ABORT_REASON = 'total_timeout';

interface SlackEnvelope {
    ok: boolean;
    error?: string;
}

interface SlackAuthTestResponse extends SlackEnvelope {
    team_id?: string;
    team?: string;
    user_id?: string;
}

interface SlackPostMessageResponse extends SlackEnvelope {
    ts?: string;
}

interface SlackConversationEntry {
    id?: string;
    name?: string;
    is_private?: boolean;
}

interface SlackConversationInfoResponse extends SlackEnvelope {
    channel?: SlackConversationEntry;
}

interface SlackConversationsJoinResponse extends SlackEnvelope {
    channel?: SlackConversationEntry;
}

export interface SlackAuthTestResult {
    teamId: string;
    teamName: string | null;
    botUserId: string;
}

export interface SlackPostMessageResult {
    timestamp: string;
}

export interface SlackConversationInfo {
    id: string;
    name: string;
    isPrivate: boolean;
}

function parseRetryAfterMs(value: string | null): number {
    if (!value) {
        return DEFAULT_RETRY_AFTER_MS;
    }

    const numericSeconds = Number.parseInt(value, 10);
    if (Number.isFinite(numericSeconds) && numericSeconds > 0) {
        return numericSeconds * 1000;
    }

    const parsedDateMs = Date.parse(value);
    if (Number.isNaN(parsedDateMs)) {
        return DEFAULT_RETRY_AFTER_MS;
    }

    return Math.max(DEFAULT_RETRY_AFTER_MS, parsedDateMs - Date.now());
}

function buildSlackApiError(input: {
    code: string;
    status: number;
    retryAfterMs: number;
}): SlackApiError {
    if (isSlackAuthErrorCode(input.code)) {
        return new SlackAuthError(`Slack auth failed: ${input.code}`, {
            code: input.code,
            status: input.status,
        });
    }

    if (isSlackChannelErrorCode(input.code)) {
        return new SlackChannelNotFoundError(`Slack channel error: ${input.code}`, {
            code: input.code,
            status: input.status,
        });
    }

    if (input.code === 'ratelimited') {
        return new SlackRateLimitError('Slack rate limited request', {
            code: input.code,
            status: input.status,
            retryAfterMs: input.retryAfterMs,
        });
    }

    if (isSlackRetryableErrorCode(input.code)) {
        return new SlackTransientError(`Slack transient error: ${input.code}`, {
            code: input.code,
            status: input.status,
        });
    }

    return new SlackApiError(`Slack API error: ${input.code}`, {
        code: input.code,
        status: input.status,
        retryable: false,
    });
}

async function parseSlackBodyWithBudget(response: Response, startedAt: number): Promise<SlackEnvelope> {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = Math.max(1, SLACK_TOTAL_TIMEOUT_MS - elapsedMs);

    let bodyTimeout: ReturnType<typeof setTimeout> | null = null;
    try {
        const payload = await Promise.race([
            response.json() as Promise<SlackEnvelope>,
            new Promise<never>((_, reject) => {
                bodyTimeout = setTimeout(() => reject(new SlackTransientError('Slack response timed out while reading body', {
                    code: TOTAL_ABORT_REASON,
                    status: response.status || 504,
                })), remainingMs);
            }),
        ]);

        return payload;
    } finally {
        if (bodyTimeout) {
            clearTimeout(bodyTimeout);
        }
    }
}

async function performSlackRequest<TResponse extends SlackEnvelope>(input: {
    token: string;
    path: string;
    method?: 'GET' | 'POST';
    query?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
}): Promise<TResponse> {
    const url = new URL(input.path, SLACK_API_BASE_URL);
    if (input.query) {
        for (const [key, value] of Object.entries(input.query)) {
            if (typeof value === 'undefined') {
                continue;
            }
            if (typeof value === 'string' && value.trim() === '') {
                continue;
            }
            url.searchParams.set(key, String(value));
        }
    }

    const startedAt = Date.now();
    const connectAbortController = new AbortController();
    const totalAbortController = new AbortController();
    const requestAbortController = new AbortController();
    const connectTimeout = setTimeout(() => {
        connectAbortController.abort(CONNECT_ABORT_REASON);
        requestAbortController.abort(CONNECT_ABORT_REASON);
    }, SLACK_CONNECT_TIMEOUT_MS);
    const totalTimeout = setTimeout(() => {
        totalAbortController.abort(TOTAL_ABORT_REASON);
        requestAbortController.abort(TOTAL_ABORT_REASON);
    }, SLACK_TOTAL_TIMEOUT_MS);
    const method = input.method ?? 'POST';

    try {
        let response: Response;
        try {
            response = await fetch(url.toString(), {
                method,
                headers: {
                    Authorization: `Bearer ${input.token}`,
                    ...(method === 'POST' ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
                },
                ...(method === 'POST' ? { body: JSON.stringify(input.body ?? {}) } : {}),
                signal: requestAbortController.signal,
            });
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                const code = requestAbortController.signal.reason === CONNECT_ABORT_REASON
                    ? CONNECT_ABORT_REASON
                    : TOTAL_ABORT_REASON;
                const phase = code === CONNECT_ABORT_REASON ? 'connecting' : 'waiting for response';
                throw new SlackTransientError(`Slack request timed out while ${phase}`, {
                    code,
                    status: 504,
                });
            }

            throw new SlackTransientError('Slack request failed', {
                code: 'network_error',
                status: 503,
            });
        }
        finally {
            clearTimeout(connectTimeout);
        }

        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));

        if (response.status === 429) {
            throw new SlackRateLimitError('Slack rate limited request', {
                code: 'ratelimited',
                status: 429,
                retryAfterMs,
            });
        }

        if (response.status >= 500) {
            throw new SlackTransientError(`Slack upstream error (${response.status})`, {
                code: 'upstream_error',
                status: response.status,
            });
        }

        const payload = await parseSlackBodyWithBudget(response, startedAt);
        if (!payload.ok) {
            throw buildSlackApiError({
                code: payload.error ?? 'unknown_error',
                status: response.status,
                retryAfterMs,
            });
        }

        return payload as TResponse;
    } finally {
        clearTimeout(totalTimeout);
    }
}

export async function authTest(token: string): Promise<SlackAuthTestResult> {
    const payload = await performSlackRequest<SlackAuthTestResponse>({
        token,
        path: 'auth.test',
    });

    if (!payload.team_id || !payload.user_id) {
        throw new SlackApiError('Slack auth.test response missing required fields', {
            code: 'invalid_response',
            status: 502,
            retryable: true,
        });
    }

    return {
        teamId: payload.team_id,
        teamName: payload.team ?? null,
        botUserId: payload.user_id,
    };
}

export async function postMessage(input: {
    token: string;
    channel: string;
    text: string;
}): Promise<SlackPostMessageResult> {
    const payload = await performSlackRequest<SlackPostMessageResponse>({
        token: input.token,
        path: 'chat.postMessage',
        body: {
            channel: input.channel,
            text: input.text,
            mrkdwn: true,
        },
    });

    if (!payload.ts) {
        throw new SlackApiError('Slack chat.postMessage response missing ts', {
            code: 'invalid_response',
            status: 502,
            retryable: true,
        });
    }

    return {
        timestamp: payload.ts,
    };
}

export async function getConversationInfo(input: {
    token: string;
    channelId: string;
}): Promise<SlackConversationInfo> {
    const payload = await performSlackRequest<SlackConversationInfoResponse>({
        token: input.token,
        path: 'conversations.info',
        method: 'GET',
        query: {
            channel: input.channelId,
        },
    });

    const id = payload.channel?.id?.trim() ?? '';
    const name = payload.channel?.name?.trim() ?? '';
    if (!id || !name) {
        throw new SlackApiError('Slack conversations.info response missing channel metadata', {
            code: 'invalid_response',
            status: 502,
            retryable: true,
        });
    }

    return {
        id,
        name,
        isPrivate: payload.channel?.is_private === true,
    };
}

export async function joinConversation(input: {
    token: string;
    channelId: string;
}): Promise<SlackConversationInfo> {
    const payload = await performSlackRequest<SlackConversationsJoinResponse>({
        token: input.token,
        path: 'conversations.join',
        body: {
            channel: input.channelId,
        },
    });

    const id = payload.channel?.id?.trim() ?? '';
    const name = payload.channel?.name?.trim() ?? '';
    if (!id || !name) {
        throw new SlackApiError('Slack conversations.join response missing channel metadata', {
            code: 'invalid_response',
            status: 502,
            retryable: true,
        });
    }

    return {
        id,
        name,
        isPrivate: payload.channel?.is_private === true,
    };
}

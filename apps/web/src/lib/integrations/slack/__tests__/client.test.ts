import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    authTest,
    getConversationInfo,
    joinConversation,
    postMessage,
} from '@/lib/integrations/slack/client';
import {
    SlackAuthError,
    SlackChannelNotFoundError,
    SlackRateLimitError,
    SlackTransientError,
} from '@/lib/integrations/slack/errors';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
        },
    });
}

describe('slack client', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('posts a message successfully', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
            ok: true,
            ts: '1711977234.1234',
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await postMessage({
            token: 'xoxb-valid',
            channel: 'C123',
            text: 'hello world',
        });

        expect(result).toEqual({ timestamp: '1711977234.1234' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toContain('https://slack.com/api/chat.postMessage');
    });

    it('throws a rate-limit error with Retry-After metadata', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(
            { ok: false, error: 'ratelimited' },
            {
                status: 429,
                headers: {
                    'Retry-After': '2',
                },
            }
        ));
        vi.stubGlobal('fetch', fetchMock);

        try {
            await postMessage({
                token: 'xoxb-valid',
                channel: 'C123',
                text: 'rate limit',
            });
            expect.unreachable('Expected SlackRateLimitError');
        } catch (error) {
            expect(error).toBeInstanceOf(SlackRateLimitError);
            expect((error as SlackRateLimitError).retryAfterMs).toBe(2000);
        }
    });

    it('throws a channel error for channel_not_found', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
            ok: false,
            error: 'channel_not_found',
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(postMessage({
            token: 'xoxb-valid',
            channel: 'C404',
            text: 'missing channel',
        })).rejects.toBeInstanceOf(SlackChannelNotFoundError);
    });

    it('throws an auth error for invalid_auth', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
            ok: false,
            error: 'invalid_auth',
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(authTest('xoxb-invalid')).rejects.toBeInstanceOf(SlackAuthError);
    });

    it('throws a transient timeout error on fetch abort', async () => {
        const abortError = new Error('Aborted');
        abortError.name = 'AbortError';
        const fetchMock = vi.fn().mockRejectedValueOnce(abortError);
        vi.stubGlobal('fetch', fetchMock);

        await expect(authTest('xoxb-timeout')).rejects.toBeInstanceOf(SlackTransientError);
    });

    it('uses GET query parameters for conversations.info', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
            ok: true,
            channel: {
                id: 'C123',
                name: 'alerts',
                is_private: false,
            },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await getConversationInfo({
            token: 'xoxb-valid',
            channelId: 'C123',
        });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('https://slack.com/api/conversations.info?channel=C123');
        expect(init.method).toBe('GET');
    });

    it('joins a conversation with POST body', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
            ok: true,
            channel: {
                id: 'C123',
                name: 'alerts',
                is_private: false,
            },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await joinConversation({
            token: 'xoxb-valid',
            channelId: 'C123',
        });

        expect(result).toEqual({
            id: 'C123',
            name: 'alerts',
            isPrivate: false,
        });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('https://slack.com/api/conversations.join');
        expect(init.method).toBe('POST');
        expect(init.body).toBe(JSON.stringify({ channel: 'C123' }));
    });

});

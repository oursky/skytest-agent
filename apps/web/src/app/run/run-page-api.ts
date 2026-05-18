type AccessTokenProvider = () => Promise<string | null>;

export async function fetchWithAccessToken(
    getAccessToken: AccessTokenProvider,
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<Response> {
    const token = await getAccessToken();
    const headers = new Headers(init?.headers);

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(input, {
        ...init,
        headers,
    });
}

export async function issueRunStreamToken(
    getAccessToken: AccessTokenProvider,
    resourceId: string
): Promise<string | null> {
    const response = await fetchWithAccessToken(getAccessToken, '/api/stream-tokens', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scope: 'test-run-events', resourceId }),
    });

    if (!response.ok) {
        return null;
    }

    const data = await response.json() as { streamToken?: string };
    return typeof data.streamToken === 'string' ? data.streamToken : null;
}

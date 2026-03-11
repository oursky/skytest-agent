'use client';

function getOrigin(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

export function createAuthgearProxyFetch(endpoint: string): typeof window.fetch {
    const endpointOrigin = endpoint ? getOrigin(endpoint) : null;

    const proxyFetch: typeof window.fetch = async (input, init) => {
        const req = new Request(input, init);

        if (!endpointOrigin) {
            return window.fetch(req);
        }

        let requestOrigin: string | null = null;
        try {
            requestOrigin = new URL(req.url).origin;
        } catch {
            requestOrigin = null;
        }

        if (requestOrigin !== endpointOrigin) {
            return window.fetch(req);
        }

        const proxyUrl = new URL('/api/authgear-proxy', window.location.origin);
        proxyUrl.searchParams.set('url', req.url);

        const proxiedHeaders = new Headers(req.headers);
        proxiedHeaders.delete('origin');
        proxiedHeaders.delete('referer');

        const method = req.method.toUpperCase();
        const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer();

        return window.fetch(proxyUrl.toString(), {
            method,
            headers: proxiedHeaders,
            body,
            redirect: req.redirect,
            signal: req.signal,
        });
    };

    return proxyFetch;
}

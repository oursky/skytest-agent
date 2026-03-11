import { NextResponse } from 'next/server';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

export const dynamic = 'force-dynamic';
const AUTHGEAR_PROXY_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

function getTargetUrl(request: Request): { targetUrl: string | null; errorResponse?: NextResponse } {
  const appUrl = new URL(request.url);
  const targetUrl = appUrl.searchParams.get('url');
  if (!targetUrl) {
    return {
      targetUrl: null,
      errorResponse: NextResponse.json({ error: 'Missing url' }, { status: 400 })
    };
  }

  const endpoint = process.env.NEXT_PUBLIC_AUTHGEAR_ENDPOINT;
  if (!endpoint) {
    return {
      targetUrl: null,
      errorResponse: NextResponse.json({ error: 'Auth endpoint not configured' }, { status: 500 })
    };
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return {
      targetUrl: null,
      errorResponse: NextResponse.json({ error: 'Invalid url' }, { status: 400 })
    };
  }

  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(endpoint).origin;
  } catch {
    return {
      targetUrl: null,
      errorResponse: NextResponse.json({ error: 'Auth endpoint misconfigured' }, { status: 500 })
    };
  }

  if (parsedTarget.origin !== allowedOrigin) {
    return {
      targetUrl: null,
      errorResponse: NextResponse.json({ error: 'Blocked url' }, { status: 403 })
    };
  }

  return { targetUrl: parsedTarget.toString() };
}

async function proxy(request: Request): Promise<NextResponse> {
  const rateLimitKey = getRateLimitKey(request, 'authgear-proxy');
  if (await isRateLimited(rateLimitKey, AUTHGEAR_PROXY_RATE_LIMIT)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { targetUrl, errorResponse } = getTargetUrl(request);
  if (!targetUrl || errorResponse) return errorResponse!;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('origin');
  headers.delete('referer');
  headers.delete('cookie');
  headers.delete('content-length');

  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: 'manual'
    });
  } catch {
    return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 });
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('set-cookie');
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('transfer-encoding');
  responseHeaders.set('cache-control', 'no-store');

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}

export async function GET(request: Request) {
  return proxy(request);
}

export async function POST(request: Request) {
  return proxy(request);
}

export async function PUT(request: Request) {
  return proxy(request);
}

export async function PATCH(request: Request) {
  return proxy(request);
}

export async function DELETE(request: Request) {
  return proxy(request);
}

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';
import { getAuthgearRuntimeConfig } from '@/lib/security/authgear-config';

export const dynamic = 'force-dynamic';
const AUTHGEAR_PROXY_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

function getTargetUrl(request: Request): { targetUrl: string | null; errorResponse?: NextResponse } {
  const appUrl = new URL(request.url);
  const targetUrl = appUrl.searchParams.get('url');
  if (!targetUrl) {
    return {
      targetUrl: null,
      errorResponse: apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Missing url' })
    };
  }

  const endpoint = getAuthgearRuntimeConfig().endpoint;
  if (!endpoint) {
    return {
      targetUrl: null,
      errorResponse: apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Auth endpoint not configured' })
    };
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return {
      targetUrl: null,
      errorResponse: apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Invalid url' })
    };
  }

  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(endpoint).origin;
  } catch {
    return {
      targetUrl: null,
      errorResponse: apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Auth endpoint misconfigured' })
    };
  }

  if (parsedTarget.origin !== allowedOrigin) {
    return {
      targetUrl: null,
      errorResponse: apiError({ status: 403, code: 'FORBIDDEN', error: 'Blocked url' })
    };
  }

  return { targetUrl: parsedTarget.toString() };
}

async function proxy(request: Request): Promise<NextResponse> {
  const rateLimitKey = getRateLimitKey(request, 'authgear-proxy');
  if (await isRateLimited(rateLimitKey, AUTHGEAR_PROXY_RATE_LIMIT)) {
    return apiError({ status: 429, code: 'RATE_LIMITED', error: 'Too many requests' });
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
    return apiError({ status: 502, code: 'INTERNAL_ERROR', error: 'Upstream request failed' });
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

import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

const logger = createLogger('api:telemetry:web-vitals');
const WEB_VITALS_RATE_LIMIT = { limit: 180, windowMs: 60_000 };
const ALLOWED_METRICS = new Set([
    'TTFB',
    'LCP',
    'INP',
    'CLS',
    'FCP',
    'LOAD_DATA_READY',
    'LOAD_REFRESH_VISIBLE',
    'LOAD_SLOW_WARNING',
]);
const ALLOWED_RATINGS = new Set(['good', 'needs-improvement', 'poor']);

interface WebVitalPayload {
    id?: unknown;
    name?: unknown;
    value?: unknown;
    rating?: unknown;
    navigationType?: unknown;
    path?: unknown;
    ts?: unknown;
}

function parsePayload(input: WebVitalPayload) {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    const name = typeof input.name === 'string' ? input.name.trim().toUpperCase() : '';
    const value = typeof input.value === 'number' && Number.isFinite(input.value) ? input.value : null;
    const rating = typeof input.rating === 'string' ? input.rating.trim().toLowerCase() : '';
    const navigationType = typeof input.navigationType === 'string' ? input.navigationType.trim() : '';
    const path = typeof input.path === 'string' ? input.path.trim() : '';
    const ts = typeof input.ts === 'number' && Number.isFinite(input.ts) ? input.ts : Date.now();

    if (!id || !ALLOWED_METRICS.has(name) || value === null || !ALLOWED_RATINGS.has(rating)) {
        return null;
    }

    return {
        id,
        name,
        value,
        rating,
        navigationType: navigationType || null,
        path: path || '/',
        ts,
    };
}

export async function POST(request: Request) {
    const rateLimitKey = getRateLimitKey(request, 'web-vitals');
    if (await isRateLimited(rateLimitKey, WEB_VITALS_RATE_LIMIT)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const payload = parsePayload(await request.json() as WebVitalPayload);
        if (!payload) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        logger.info('Web vitals metric', payload);
        return new NextResponse(null, { status: 204 });
    } catch {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
}

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

const logger = createLogger('api:telemetry:web-vitals');
const WEB_VITALS_RATE_LIMIT = { limit: 180, windowMs: 60_000 };
const MAX_METRIC_ID_LENGTH = 128;
const MAX_NAVIGATION_TYPE_LENGTH = 64;
const MAX_PATH_LENGTH = 512;
const ALLOWED_METRICS = new Set([
    'TTFB',
    'LCP',
    'INP',
    'FID',
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

    if (
        !id
        || id.length > MAX_METRIC_ID_LENGTH
        || value === null
        || !ALLOWED_RATINGS.has(rating)
        || navigationType.length > MAX_NAVIGATION_TYPE_LENGTH
        || path.length > MAX_PATH_LENGTH
    ) {
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
    // Intentionally unauthenticated: browser `sendBeacon` telemetry must work during navigation
    // and before auth state is ready. Abuse is constrained by strict payload validation + IP rate limiting.
    const rateLimitKey = getRateLimitKey(request, 'web-vitals');
    if (await isRateLimited(rateLimitKey, WEB_VITALS_RATE_LIMIT)) {
        return apiError({ status: 429, code: 'RATE_LIMITED', error: 'Too many requests' });
    }

    try {
        const payload = parsePayload(await request.json() as WebVitalPayload);
        if (!payload) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Invalid payload' });
        }

        if (!ALLOWED_METRICS.has(payload.name)) {
            logger.debug('Ignoring unsupported web vitals metric', {
                id: payload.id,
                name: payload.name,
            });
            return new NextResponse(null, { status: 204 });
        }

        logger.info('Web vitals metric', payload);
        return new NextResponse(null, { status: 204 });
    } catch {
        return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Invalid payload' });
    }
}

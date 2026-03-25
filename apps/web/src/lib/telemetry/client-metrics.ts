'use client';

type MetricRating = 'good' | 'needs-improvement' | 'poor';

interface ClientMetricPayload {
    id: string;
    name: string;
    value: number;
    rating: MetricRating;
    navigationType: string | null;
    path: string;
    ts: number;
}

interface ReportClientMetricInput {
    name: string;
    value: number;
    rating?: MetricRating;
    navigationType?: string | null;
    path?: string;
}

interface ReportLoadMetricInput {
    elapsedMs: number;
    isRefreshRequest: boolean;
    context: string;
}

function createMetricId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `metric-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function postMetric(payload: ClientMetricPayload): void {
    const body = JSON.stringify(payload);
    const url = '/api/telemetry/web-vitals';

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) {
            return;
        }
    }

    void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
    }).catch(() => {});
}

function rateDurationMetric(durationMs: number): MetricRating {
    if (durationMs < 1_000) {
        return 'good';
    }
    if (durationMs < 3_000) {
        return 'needs-improvement';
    }
    return 'poor';
}

export function reportClientMetric(input: ReportClientMetricInput): void {
    if (!Number.isFinite(input.value)) {
        return;
    }

    postMetric({
        id: createMetricId(),
        name: input.name.trim().toUpperCase(),
        value: input.value,
        rating: input.rating ?? 'good',
        navigationType: input.navigationType ?? null,
        path: input.path ?? (typeof window !== 'undefined' ? window.location.pathname : '/'),
        ts: Date.now(),
    });
}

export function reportLoadMetric(input: ReportLoadMetricInput): void {
    const elapsedMs = Math.max(0, input.elapsedMs);
    reportClientMetric({
        name: input.isRefreshRequest ? 'LOAD_REFRESH_VISIBLE' : 'LOAD_DATA_READY',
        value: elapsedMs,
        rating: rateDurationMetric(elapsedMs),
    });

    if (elapsedMs >= 1_500) {
        reportClientMetric({
            name: 'LOAD_SLOW_WARNING',
            value: elapsedMs,
            rating: elapsedMs >= 3_000 ? 'poor' : 'needs-improvement',
        });
        console.warn(`[${input.context}] slow load detected`, { elapsedMs });
    }
}

export type { MetricRating, ReportClientMetricInput, ReportLoadMetricInput };

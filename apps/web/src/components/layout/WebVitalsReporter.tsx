'use client';

import { useReportWebVitals } from 'next/web-vitals';

type WebVitalMetricPayload = {
    id: string;
    name: string;
    value: number;
    rating: 'good' | 'needs-improvement' | 'poor';
    navigationType: string | null;
    path: string;
    ts: number;
};

function postWebVital(payload: WebVitalMetricPayload): void {
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

export function WebVitalsReporter() {
    useReportWebVitals((metric) => {
        postWebVital({
            id: metric.id,
            name: metric.name,
            value: metric.value,
            rating: metric.rating,
            navigationType: metric.navigationType ?? null,
            path: typeof window !== 'undefined' ? window.location.pathname : '',
            ts: Date.now(),
        });
    });

    return null;
}

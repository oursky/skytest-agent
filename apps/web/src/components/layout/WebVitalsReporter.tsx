'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { reportClientMetric } from '@/lib/telemetry/client-metrics';

export function WebVitalsReporter() {
    useReportWebVitals((metric) => {
        reportClientMetric({
            name: metric.name,
            value: metric.value,
            rating: metric.rating,
            navigationType: metric.navigationType ?? null,
            path: typeof window !== 'undefined' ? window.location.pathname : '/',
        });
    });

    return null;
}

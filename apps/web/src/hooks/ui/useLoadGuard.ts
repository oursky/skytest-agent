import { useEffect, useState } from 'react';

interface UseLoadGuardOptions {
    slowAfterMs?: number;
    stalledAfterMs?: number;
}

export function useLoadGuard(isLoading: boolean, options: UseLoadGuardOptions = {}) {
    const slowAfterMs = options.slowAfterMs ?? 1_500;
    const stalledAfterMs = options.stalledAfterMs ?? 8_000;
    const [phase, setPhase] = useState<'idle' | 'slow' | 'stalled'>('idle');

    useEffect(() => {
        if (!isLoading) {
            queueMicrotask(() => {
                setPhase('idle');
            });
            return;
        }
        const slowTimer = setTimeout(() => {
            setPhase('slow');
        }, slowAfterMs);
        const stalledTimer = setTimeout(() => {
            setPhase('stalled');
        }, stalledAfterMs);

        return () => {
            clearTimeout(slowTimer);
            clearTimeout(stalledTimer);
        };
    }, [isLoading, slowAfterMs, stalledAfterMs]);

    return {
        isSlow: isLoading && (phase === 'slow' || phase === 'stalled'),
        isStalled: isLoading && phase === 'stalled',
    };
}

export type { UseLoadGuardOptions };

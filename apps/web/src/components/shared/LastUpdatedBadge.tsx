'use client';

import { useEffect, useMemo, useState } from 'react';

interface LastUpdatedBadgeProps {
    lastUpdatedAt: number | null;
    className?: string;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

function formatRelative(lastUpdatedAt: number): string {
    const deltaSeconds = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000));
    if (deltaSeconds < 5) return 'just now';
    if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
    const minutes = Math.floor(deltaSeconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

export default function LastUpdatedBadge({ lastUpdatedAt, className }: LastUpdatedBadgeProps) {
    const [, setTick] = useState(0);

    useEffect(() => {
        if (!lastUpdatedAt) {
            return;
        }
        const timer = setInterval(() => {
            setTick((value) => value + 1);
        }, 15_000);
        return () => clearInterval(timer);
    }, [lastUpdatedAt]);

    const label = useMemo(() => {
        if (!lastUpdatedAt) {
            return 'Not updated yet';
        }
        return `Updated ${formatRelative(lastUpdatedAt)}`;
    }, [lastUpdatedAt]);

    return (
        <span
            className={joinClasses(
                'inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600',
                className
            )}
        >
            {label}
        </span>
    );
}

export type { LastUpdatedBadgeProps };

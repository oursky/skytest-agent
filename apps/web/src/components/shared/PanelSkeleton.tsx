'use client';

import { joinClasses } from './class-names';

interface PanelSkeletonProps {
    className?: string;
    lines?: number;
}

export default function PanelSkeleton({ className, lines = 3 }: PanelSkeletonProps) {
    return (
        <div className={joinClasses('rounded-lg border border-gray-200 bg-white p-6 shadow-sm', className)}>
            <div className="skeleton-block h-5 w-40" />
            <div className="mt-5 space-y-3">
                {Array.from({ length: Math.max(1, lines) }, (_, index) => (
                    <div
                        key={`panel-skeleton-${index}`}
                        className={joinClasses(
                            'skeleton-block h-4',
                            index === lines - 1 ? 'w-5/12' : 'w-full'
                        )}
                    />
                ))}
            </div>
        </div>
    );
}

export type { PanelSkeletonProps };

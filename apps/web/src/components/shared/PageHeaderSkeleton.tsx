'use client';

interface PageHeaderSkeletonProps {
    withAction?: boolean;
}

export default function PageHeaderSkeleton({ withAction = true }: PageHeaderSkeletonProps) {
    return (
        <div className="mb-8 flex items-center justify-between">
            <div className="space-y-3">
                <div className="skeleton-block h-8 w-56" />
                <div className="skeleton-block h-4 w-80" />
            </div>
            {withAction && (
                <div className="skeleton-block h-10 w-32" />
            )}
        </div>
    );
}

export type { PageHeaderSkeletonProps };

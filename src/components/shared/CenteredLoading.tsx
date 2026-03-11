'use client';

import LoadingSpinner from './LoadingSpinner';

interface CenteredLoadingProps {
    size?: number;
    className?: string;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export default function CenteredLoading({ size = 32, className }: CenteredLoadingProps) {
    return (
        <div className={joinClasses('flex items-center justify-center', className)}>
            <LoadingSpinner size={size} />
        </div>
    );
}

export type { CenteredLoadingProps };

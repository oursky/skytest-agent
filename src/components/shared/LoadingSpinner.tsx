'use client';

interface LoadingSpinnerProps {
    size?: number;
    className?: string;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export default function LoadingSpinner({ size = 16, className }: LoadingSpinnerProps) {
    return (
        <div
            className={joinClasses('animate-spin rounded-full border-b-2 border-primary', className)}
            style={{ width: size, height: size }}
            aria-hidden="true"
        />
    );
}

export type { LoadingSpinnerProps };

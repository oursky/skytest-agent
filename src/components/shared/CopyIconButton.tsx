'use client';

interface CopyIconButtonProps {
    copied: boolean;
    copyLabel: string;
    copiedLabel: string;
    onClick: () => void;
    className?: string;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export default function CopyIconButton({
    copied,
    copyLabel,
    copiedLabel,
    onClick,
    className,
}: CopyIconButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={copied ? copiedLabel : copyLabel}
            title={copied ? copiedLabel : copyLabel}
            className={joinClasses(
                'h-7 w-7 cursor-pointer rounded border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-100',
                'inline-flex items-center justify-center',
                className
            )}
        >
            {copied ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <rect x="9" y="9" width="10" height="10" rx="2" strokeWidth="2" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 15H6a2 2 0 01-2-2V6a2 2 0 012-2h7a2 2 0 012 2v1" />
                </svg>
            )}
        </button>
    );
}

export type { CopyIconButtonProps };

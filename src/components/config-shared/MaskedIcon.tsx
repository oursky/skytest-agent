interface MaskedIconProps {
    masked: boolean;
}

export default function MaskedIcon({ masked }: MaskedIconProps) {
    if (masked) {
        return (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.477 10.477a3 3 0 004.243 4.243" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.228 6.228A9.956 9.956 0 002.458 12c1.274 4.057 5.065 7 9.542 7 1.531 0 2.974-.344 4.263-.959" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.878 5.083A9.964 9.964 0 0112 5c4.478 0 8.268 2.943 9.542 7a9.97 9.97 0 01-2.334 4.294" />
            </svg>
        );
    }

    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5s8.268 2.943 9.542 7c-1.274 4.057-5.065 7-9.542 7S3.732 16.057 2.458 12z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
    );
}

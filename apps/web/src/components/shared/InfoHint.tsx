'use client';

interface InfoHintProps {
    text: string;
    label?: string;
    className?: string;
}

export default function InfoHint({ text, label, className = '' }: InfoHintProps) {
    return (
        <span className={`group relative inline-flex ${className}`.trim()}>
            <button
                type="button"
                aria-label={label ?? text}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold leading-none text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
                ?
            </button>
            <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-[80] mt-1.5 w-56 -translate-x-1/2 rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            >
                {text}
            </span>
        </span>
    );
}

'use client';

import CopyIconButton from './CopyIconButton';

interface CopyableCodeBlockProps {
    code: string;
    copied: boolean;
    onCopy: () => void;
    copyLabel: string;
    copiedLabel: string;
    className?: string;
    preClassName?: string;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export default function CopyableCodeBlock({
    code,
    copied,
    onCopy,
    copyLabel,
    copiedLabel,
    className,
    preClassName,
}: CopyableCodeBlockProps) {
    return (
        <div className={joinClasses('relative', className)}>
            <CopyIconButton
                copied={copied}
                copyLabel={copyLabel}
                copiedLabel={copiedLabel}
                onClick={onCopy}
                className="absolute right-2 top-2 z-10"
            />
            <pre className={joinClasses('overflow-x-auto rounded border border-gray-200 bg-gray-50 p-3 pr-10 text-xs text-gray-800', preClassName)}>
                <code>{code}</code>
            </pre>
        </div>
    );
}

export type { CopyableCodeBlockProps };

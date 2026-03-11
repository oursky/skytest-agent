'use client';

import Button, { type ButtonProps, type ButtonSize } from './Button';

interface DangerTextButtonProps extends Omit<ButtonProps, 'variant' | 'size'> {
    tone?: 'default' | 'strong';
    size?: ButtonSize;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export default function DangerTextButton({
    tone = 'default',
    size = 'sm',
    className,
    ...props
}: DangerTextButtonProps) {
    return (
        <Button
            {...props}
            variant="ghost"
            size={size}
            className={joinClasses(
                'h-auto p-0 text-red-600 hover:bg-transparent',
                tone === 'strong' ? 'hover:text-red-800' : 'hover:text-red-700',
                className
            )}
        />
    );
}

export type { DangerTextButtonProps };

'use client';

import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'xs' | 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

const variantClasses: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-white hover:bg-primary/90',
    secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-gray-700 hover:bg-gray-100',
};

const sizeClasses: Record<ButtonSize, string> = {
    xs: 'h-7 px-2.5 text-xs',
    sm: 'h-9 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
};

export default function Button({
    type = 'button',
    variant = 'secondary',
    size = 'sm',
    fullWidth = false,
    className,
    ...props
}: ButtonProps) {
    return (
        <button
            type={type}
            className={joinClasses(
                'inline-flex cursor-pointer items-center justify-center rounded-md font-medium transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                'disabled:cursor-not-allowed disabled:opacity-50',
                variantClasses[variant],
                sizeClasses[size],
                fullWidth ? 'w-full' : '',
                className
            )}
            {...props}
        />
    );
}

export type { ButtonProps, ButtonSize, ButtonVariant };

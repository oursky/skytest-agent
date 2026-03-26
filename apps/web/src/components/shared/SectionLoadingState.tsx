'use client';

import type { ReactNode } from 'react';
import { joinClasses } from './class-names';

interface SectionLoadingStateProps {
    children: ReactNode;
    className?: string;
}

export default function SectionLoadingState({
    children,
    className,
}: SectionLoadingStateProps) {
    return (
        <div className={joinClasses('space-y-3', className)}>
            {children}
        </div>
    );
}

export type { SectionLoadingStateProps };

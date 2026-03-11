'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';

export interface BreadcrumbItem {
    label: string;
    href?: string;
}

interface BreadcrumbsProps {
    items: BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
    const { t } = useI18n();

    if (items.length === 0) return null;

    return (
        <nav className="flex items-center space-x-2 text-sm mb-6" aria-label="Breadcrumb">
            <Link
                href="/projects"
                className="text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span>{t('breadcrumbs.projects')}</span>
            </Link>

            {items.map((item, index) => {
                const isLast = index === items.length - 1;

                return (
                    <div key={index} className="flex items-center space-x-2">
                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>

                        {isLast || !item.href ? (
                            <span className="text-gray-900 font-medium">
                                {item.label}
                            </span>
                        ) : (
                            <Link
                                href={item.href}
                                className="text-gray-500 hover:text-gray-700 transition-colors"
                            >
                                {item.label}
                            </Link>
                        )}
                    </div>
                );
            })}
        </nav>
    );
}

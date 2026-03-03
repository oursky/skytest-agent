"use client";

import { useI18n } from "@/i18n";

interface PaginationProps {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default function Pagination({
    page,
    limit,
    total,
    totalPages,
    onPageChange,
    onLimitChange,
}: PaginationProps) {
    const { t } = useI18n();

    const from = total > 0 ? (page - 1) * limit + 1 : 0;
    const to = Math.min(page * limit, total);

    return (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center gap-4">
                <p className="text-sm text-gray-500">
                    {total > 0
                        ? t('pagination.showing', { from, to, total })
                        : t('pagination.noRecords')}
                </p>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">{t('pagination.rowsPerPage')}</span>
                    <select
                        value={limit}
                        onChange={(e) => onLimitChange(Number(e.target.value))}
                        className="px-2 py-1 text-sm text-gray-600 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                            <option key={size} value={size}>
                                {size}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => onPageChange(page - 1)}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                >
                    {t('pagination.previous')}
                </button>
                <span className="text-sm text-gray-600">
                    {t('pagination.pageOf', { page, totalPages: totalPages || 1 })}
                </span>
                <button
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                >
                    {t('pagination.next')}
                </button>
            </div>
        </div>
    );
}

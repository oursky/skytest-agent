'use client';

interface TableRowsSkeletonProps {
    rows?: number;
    columns?: number;
}

export default function TableRowsSkeleton({ rows = 6, columns = 3 }: TableRowsSkeletonProps) {
    const safeRows = Math.max(1, rows);
    const safeColumns = Math.max(1, columns);
    return (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div
                className="grid gap-4 border-b border-gray-200 bg-gray-50 p-4"
                style={{ gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))` }}
            >
                {Array.from({ length: safeColumns }, (_, index) => (
                    <div key={`table-head-${index}`} className="skeleton-block h-4 w-20" />
                ))}
            </div>
            <div className="divide-y divide-gray-100 p-4">
                {Array.from({ length: safeRows }, (_, rowIndex) => (
                    <div
                        key={`table-row-${rowIndex}`}
                        className="grid items-center gap-4 py-3"
                        style={{ gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))` }}
                    >
                        {Array.from({ length: safeColumns }, (_, colIndex) => (
                            <div key={`table-cell-${rowIndex}-${colIndex}`} className="skeleton-block h-4 w-full" />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export type { TableRowsSkeletonProps };

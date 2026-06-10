'use client';

import { TEST_STATUS } from '@/types';

interface RunStatusBadgeProps {
    status: string | null;
    t: (key: string, values?: Record<string, string | number>) => string;
}

const STATUS_STYLES: Record<string, string> = {
    [TEST_STATUS.PASS]: 'bg-emerald-100 text-emerald-700',
    [TEST_STATUS.FAIL]: 'bg-red-100 text-red-700',
    [TEST_STATUS.CANCELLED]: 'bg-gray-100 text-gray-600',
    [TEST_STATUS.RUNNING]: 'bg-blue-100 text-blue-700',
    [TEST_STATUS.PREPARING]: 'bg-cyan-100 text-cyan-700',
    [TEST_STATUS.QUEUED]: 'bg-amber-100 text-amber-700',
    [TEST_STATUS.DRAFT]: 'bg-gray-100 text-gray-500',
};

function statusLabel(status: string, t: RunStatusBadgeProps['t']): string {
    switch (status) {
        case TEST_STATUS.QUEUED:
            return t('project.scheduler.runStatus.QUEUED');
        case TEST_STATUS.PREPARING:
            return t('project.scheduler.runStatus.PREPARING');
        case TEST_STATUS.RUNNING:
            return t('project.scheduler.runStatus.RUNNING');
        case TEST_STATUS.PASS:
            return t('project.scheduler.runStatus.PASS');
        case TEST_STATUS.FAIL:
            return t('project.scheduler.runStatus.FAIL');
        case TEST_STATUS.CANCELLED:
            return t('project.scheduler.runStatus.CANCELLED');
        case TEST_STATUS.DRAFT:
            return t('project.scheduler.runStatus.DRAFT');
        default:
            return status;
    }
}

export default function RunStatusBadge({ status, t }: RunStatusBadgeProps) {
    if (!status) {
        return <span className="text-xs text-gray-400">{t('project.scheduler.testCases.neverRun')}</span>;
    }

    const style = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600';
    return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
            {statusLabel(status, t)}
        </span>
    );
}

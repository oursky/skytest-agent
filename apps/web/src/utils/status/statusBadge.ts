import { TEST_STATUS, type TestStatus } from '@/types';

export const STATUS_BADGE_CLASSES: Record<TestStatus, string> = {
    [TEST_STATUS.DRAFT]: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    [TEST_STATUS.QUEUED]: 'bg-purple-100 text-purple-800 border-purple-200',
    [TEST_STATUS.PREPARING]: 'bg-cyan-100 text-cyan-800 border-cyan-200',
    [TEST_STATUS.RUNNING]: 'bg-blue-100 text-blue-800 border-blue-200',
    [TEST_STATUS.PASS]: 'bg-green-100 text-green-800 border-green-200',
    [TEST_STATUS.FAIL]: 'bg-red-100 text-red-800 border-red-200',
    [TEST_STATUS.CANCELLED]: 'bg-gray-100 text-gray-800 border-gray-200',
};

export function getStatusBadgeClass(status?: string | null): string {
    if (!status) return 'bg-gray-100 text-gray-800 border-gray-200';
    return (STATUS_BADGE_CLASSES as Record<string, string>)[status] || 'bg-gray-100 text-gray-800 border-gray-200';
}

import type { TestStatus } from '@/types';

export const STATUS_BADGE_CLASSES: Record<TestStatus, string> = {
    IDLE: 'bg-gray-100 text-gray-700 border-gray-200',
    DRAFT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    QUEUED: 'bg-purple-100 text-purple-800 border-purple-200',
    RUNNING: 'bg-blue-100 text-blue-800 border-blue-200',
    PASS: 'bg-green-100 text-green-800 border-green-200',
    FAIL: 'bg-red-100 text-red-800 border-red-200',
    CANCELLED: 'bg-gray-100 text-gray-800 border-gray-200',
};

export function getStatusBadgeClass(status?: string | null): string {
    if (!status) return 'bg-gray-100 text-gray-800 border-gray-200';
    return (STATUS_BADGE_CLASSES as Record<string, string>)[status] || 'bg-gray-100 text-gray-800 border-gray-200';
}

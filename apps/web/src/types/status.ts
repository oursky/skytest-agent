export const TEST_STATUS = {
    DRAFT: 'DRAFT',
    QUEUED: 'QUEUED',
    PREPARING: 'PREPARING',
    RUNNING: 'RUNNING',
    PASS: 'PASS',
    FAIL: 'FAIL',
    CANCELLED: 'CANCELLED',
} as const;

export type TestStatus = typeof TEST_STATUS[keyof typeof TEST_STATUS];
export type RunTerminalStatus = typeof RUN_TERMINAL_STATUSES[number];
export type RunInProgressStatus = typeof RUN_IN_PROGRESS_STATUSES[number];
export type RunActiveStatus = typeof RUN_ACTIVE_STATUSES[number];

export const RUN_STATUSES = [
    TEST_STATUS.QUEUED,
    TEST_STATUS.PREPARING,
    TEST_STATUS.RUNNING,
    TEST_STATUS.PASS,
    TEST_STATUS.FAIL,
    TEST_STATUS.CANCELLED,
] as const;
export type RunStatus = typeof RUN_STATUSES[number];

export const RUN_TERMINAL_STATUSES = [
    TEST_STATUS.PASS,
    TEST_STATUS.FAIL,
    TEST_STATUS.CANCELLED,
] as const;

export const RUN_IN_PROGRESS_STATUSES = [
    TEST_STATUS.PREPARING,
    TEST_STATUS.RUNNING,
] as const;

export const RUN_ACTIVE_STATUSES = [
    TEST_STATUS.QUEUED,
    TEST_STATUS.PREPARING,
    TEST_STATUS.RUNNING,
] as const;

const runTerminalStatusSet = new Set<string>(RUN_TERMINAL_STATUSES);
const runInProgressStatusSet = new Set<string>(RUN_IN_PROGRESS_STATUSES);
const runActiveStatusSet = new Set<string>(RUN_ACTIVE_STATUSES);

export function isRunTerminalStatus(status: string | null | undefined): status is RunTerminalStatus {
    return typeof status === 'string' && runTerminalStatusSet.has(status);
}

export function isRunInProgressStatus(status: string | null | undefined): status is RunInProgressStatus {
    return typeof status === 'string' && runInProgressStatusSet.has(status);
}

export function isRunActiveStatus(status: string | null | undefined): status is RunActiveStatus {
    return typeof status === 'string' && runActiveStatusSet.has(status);
}

export const ACTIVE_RUN_STATUSES: readonly string[] = ['RUNNING', 'QUEUED', 'PREPARING'];

export function isActiveRunStatus(status: string | null | undefined): boolean {
    return !!status && ACTIVE_RUN_STATUSES.includes(status);
}

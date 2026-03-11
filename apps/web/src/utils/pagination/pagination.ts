export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export function parsePageSize(value: string | null): number {
    if (!value) {
        return DEFAULT_PAGE_SIZE;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_PAGE_SIZE;
    }

    return PAGE_SIZE_OPTIONS.some((size) => size === parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

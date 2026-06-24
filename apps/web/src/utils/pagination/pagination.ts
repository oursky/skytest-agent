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

/**
 * Safely reads the items from a list API response, whether it is a bare array or
 * a `{ data: T[] }` paginated envelope. Returns [] for any other shape (null, an
 * error object, an unexpected type), so callers can never crash on `.map`/`.filter`.
 *
 * List endpoints in this app vary: some return a bare array, some a paginated
 * envelope, and `/projects/[id]/test-cases` returns either depending on the query.
 * Reading `response.json()` with a blind `as T[]` cast hides that mismatch from the
 * compiler and crashes at render time. Route every list fetch through this helper
 * instead of casting, so the shape is normalized in one audited place.
 */
export function extractListData<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) {
        return payload as T[];
    }
    if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
        return (payload as { data: T[] }).data;
    }
    return [];
}

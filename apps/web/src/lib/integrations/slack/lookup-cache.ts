interface CacheEntry<TValue> {
    expiresAt: number;
    value: TValue;
}

const LOOKUP_CACHE_TTL_MS = 1_000;
const lookupCache = new Map<string, CacheEntry<unknown>>();

export function getLookupCacheValue<TValue>(key: string): TValue | null {
    const entry = lookupCache.get(key);
    if (!entry) {
        return null;
    }

    if (Date.now() >= entry.expiresAt) {
        lookupCache.delete(key);
        return null;
    }

    return entry.value as TValue;
}

export function setLookupCacheValue<TValue>(key: string, value: TValue): void {
    lookupCache.set(key, {
        value,
        expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
    });
}

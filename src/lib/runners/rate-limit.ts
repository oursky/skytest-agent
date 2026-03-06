interface RateLimitWindow {
    count: number;
    windowStartMs: number;
}

const windows = new Map<string, RateLimitWindow>();

export function isRateLimited(key: string, input: { limit: number; windowMs: number }): boolean {
    const now = Date.now();
    const existing = windows.get(key);

    if (!existing || now - existing.windowStartMs >= input.windowMs) {
        windows.set(key, { count: 1, windowStartMs: now });
        return false;
    }

    existing.count += 1;
    if (existing.count > input.limit) {
        return true;
    }

    return false;
}

export function getRateLimitKey(request: Request, prefix: string): string {
    const forwardedFor = request.headers.get('x-forwarded-for') || '';
    const firstForwarded = forwardedFor.split(',')[0]?.trim();
    const realIp = request.headers.get('x-real-ip')?.trim();
    const address = firstForwarded || realIp || 'unknown';
    return `${prefix}:${address}`;
}

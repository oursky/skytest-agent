import type { Logger } from '@/lib/core/logger';

interface RoutePerfLogMeta {
    route: string;
    method: string;
    statusCode: number;
    requestId: string | null;
    authMs: number;
    dbMs: number;
    handlerMs: number;
    totalMs: number;
    responseBytes: number;
}

function resolveRequestId(request: Request): string | null {
    return request.headers.get('x-request-id')
        || request.headers.get('fly-request-id')
        || request.headers.get('traceparent')
        || null;
}

export function measureJsonBytes(payload: unknown): number {
    try {
        return Buffer.byteLength(JSON.stringify(payload));
    } catch {
        return 0;
    }
}

export function createRoutePerfTracker(route: string, request: Request) {
    const startedAtMs = Date.now();
    const requestId = resolveRequestId(request);
    let authMs = 0;
    let dbMs = 0;

    function addAuthMs(elapsedMs: number): void {
        authMs += elapsedMs;
    }

    function addDbMs(elapsedMs: number): void {
        dbMs += elapsedMs;
    }

    function snapshot(input: { statusCode: number; responseBytes: number }): RoutePerfLogMeta {
        const totalMs = Date.now() - startedAtMs;
        const handlerMs = Math.max(0, totalMs - authMs - dbMs);
        return {
            route,
            method: request.method,
            statusCode: input.statusCode,
            requestId,
            authMs,
            dbMs,
            handlerMs,
            totalMs,
            responseBytes: input.responseBytes,
        };
    }

    function log(logger: Logger, input: { statusCode: number; responseBytes: number }): void {
        logger.info('Route performance', snapshot(input));
    }

    async function measureAuth<T>(operation: () => Promise<T>): Promise<T> {
        const started = Date.now();
        try {
            return await operation();
        } finally {
            addAuthMs(Date.now() - started);
        }
    }

    async function measureDb<T>(operation: () => Promise<T>): Promise<T> {
        const started = Date.now();
        try {
            return await operation();
        } finally {
            addDbMs(Date.now() - started);
        }
    }

    return {
        measureAuth,
        measureDb,
        addAuthMs,
        addDbMs,
        log,
        snapshot,
    };
}

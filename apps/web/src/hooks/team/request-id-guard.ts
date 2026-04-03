export interface RequestIdGuard {
    next: () => number;
    isLatest: (requestId: number) => boolean;
}

export function createRequestIdGuard(): RequestIdGuard {
    let latestRequestId = 0;

    return {
        next: () => {
            latestRequestId += 1;
            return latestRequestId;
        },
        isLatest: (requestId: number) => requestId === latestRequestId,
    };
}

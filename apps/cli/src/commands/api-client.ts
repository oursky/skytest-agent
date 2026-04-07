interface SyncProjectCatalogOptions {
    projectId: string;
    syncBeforeRun?: boolean;
    syncRoot?: string;
}

export function normalizeBaseUrl(input: string): string {
    return input.endsWith('/') ? input.slice(0, -1) : input;
}

export function resolveBaseUrl(value?: string): string {
    const fallback = process.env.SKYTEST_BASE_URL ?? process.env.RUNNER_CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000';
    return normalizeBaseUrl((value ?? fallback).trim());
}

export function resolveAuthToken(value?: string): string {
    const token = value ?? process.env.SKYTEST_API_KEY ?? process.env.SKYTEST_TOKEN;
    if (!token || !token.trim()) {
        throw new Error('Missing auth token. Set --api-key/--token or SKYTEST_API_KEY.');
    }
    return token.trim();
}

export async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`${context} failed with ${response.status}: ${errorBody}`);
    }

    return await response.json() as T;
}

export async function syncProjectCatalogIfNeeded(
    baseUrl: string,
    authToken: string,
    options: SyncProjectCatalogOptions,
): Promise<void> {
    if (options.syncBeforeRun === false) {
        return;
    }

    const payload = options.syncRoot ? { root: options.syncRoot } : {};
    const response = await fetch(
        `${baseUrl}/api/projects/${encodeURIComponent(options.projectId)}/test-cases/sync`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify(payload),
        },
    );

    await parseJsonResponse<{ imported: number; updated: number }>(response, 'Sync project catalog');
}

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/core/prisma', () => ({
    prisma: {},
}));

vi.mock('@/lib/security/test-case-route-access', () => ({
    guardTestCaseRouteRequest: vi.fn(),
}));

vi.mock('@/lib/test-config/resolver', () => ({
    resolveConfigs: vi.fn(),
}));

vi.mock('@/lib/test-config/url-validation', () => ({
    hasTemplatedConfigUrls: vi.fn(),
    validateConfigUrls: vi.fn(),
}));

vi.mock('@/lib/runners/availability-service', () => ({
    getTeamDevicesAvailability: vi.fn(),
}));

vi.mock('@/lib/runtime/instance-identity', () => ({
    ensureRuntimeInstanceIdentity: vi.fn(),
}));

vi.mock('@/lib/runtime/runtime-config-loader', () => ({
    loadRuntimeConfigForCwd: vi.fn(),
}));

const { POST } = await import('@/app/api/test-runs/dispatch/route');

describe('POST /api/test-runs/dispatch malformed json', () => {
    it('returns validation error for malformed json payloads', async () => {
        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: '{',
        });

        const response = await POST(request);
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toMatchObject({
            code: 'VALIDATION_ERROR',
            error: 'Invalid JSON request body',
        });
    });
});

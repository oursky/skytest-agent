import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    guardProjectRouteRequest: vi.fn(),
    prisma: {
        project: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('@/lib/security/project-route-access', () => ({
    guardProjectRouteRequest: mocks.guardProjectRouteRequest,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: mocks.prisma,
}));

const { POST } = await import('@/app/api/projects/[id]/slack/preview/route');

describe('/api/projects/[id]/slack/preview', () => {
    beforeEach(() => {
        mocks.guardProjectRouteRequest.mockReset();
        mocks.prisma.project.findUnique.mockReset();

        mocks.guardProjectRouteRequest.mockResolvedValue({
            ok: true,
            userId: 'user-1',
            params: { id: 'project-1' },
        });
        mocks.prisma.project.findUnique.mockResolvedValue({
            name: 'Storefront',
            slackMessageTemplate: null,
        });
    });

    it('renders preview with sample context', async () => {
        const response = await POST(new Request('http://localhost/api/projects/project-1/slack/preview', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ template: 'Run {runId} failed in {projectName}' }),
        }), {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.text).toContain('run_preview_001');
        expect(payload.text).toContain('Storefront');
    });
});

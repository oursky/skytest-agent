import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    isTeamMember: vi.fn(),
    parseActionCountFromResult: vi.fn(),
    recordUsage: vi.fn(),
    testRunFindMany: vi.fn(),
    testRunCount: vi.fn(),
    usageRecordFindMany: vi.fn(),
    usageRecordCount: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/permissions', () => ({
    isTeamMember: mocks.isTeamMember,
}));

vi.mock('@/lib/runtime/usage', () => ({
    parseActionCountFromResult: mocks.parseActionCountFromResult,
    UsageService: {
        recordUsage: mocks.recordUsage,
    },
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findMany: mocks.testRunFindMany,
            count: mocks.testRunCount,
        },
        usageRecord: {
            findMany: mocks.usageRecordFindMany,
            count: mocks.usageRecordCount,
        },
    }
}));

const { GET } = await import('@/app/api/teams/[id]/usage/route');

describe('GET /api/teams/[id]/usage', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.isTeamMember.mockReset();
        mocks.parseActionCountFromResult.mockReset();
        mocks.recordUsage.mockReset();
        mocks.testRunFindMany.mockReset();
        mocks.testRunCount.mockReset();
        mocks.usageRecordFindMany.mockReset();
        mocks.usageRecordCount.mockReset();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');
        mocks.isTeamMember.mockResolvedValue(true);
        mocks.parseActionCountFromResult.mockReturnValue(4);
        mocks.recordUsage.mockResolvedValue(undefined);
        mocks.testRunFindMany.mockResolvedValue([
            {
                id: 'run-1',
                result: '{"actionCount":4}',
                testCase: {
                    name: 'Checkout flow',
                    project: {
                        id: 'project-1',
                        name: 'Shop',
                        createdByUserId: 'user-1',
                    }
                }
            }
        ]);
        mocks.testRunCount.mockResolvedValue(6);
        mocks.usageRecordFindMany.mockResolvedValue([
            {
                id: 'usage-1',
                type: 'TEST_RUN',
                description: 'Shop - Checkout flow',
                aiActions: 4,
                createdAt: new Date('2026-03-10T00:00:00.000Z').toISOString(),
                project: { id: 'project-1', name: 'Shop' },
                actorUser: { id: 'user-1', email: 'user@example.com' },
                testRun: {
                    id: 'run-1',
                    createdAt: new Date('2026-03-10T00:00:00.000Z').toISOString(),
                    testCase: {
                        id: 'tc-1',
                        displayId: 'TC-1',
                        name: 'Checkout flow',
                    }
                }
            }
        ]);
        mocks.usageRecordCount
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(1);
    });

    it('backfills usage from completed runs and returns paginated records', async () => {
        const request = new Request('http://localhost/api/teams/team-1/usage?page=1&limit=20');

        const response = await GET(request, { params: Promise.resolve({ id: 'team-1' }) });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.recordUsage).toHaveBeenCalledWith(
            'user-1',
            'project-1',
            4,
            'Shop - Checkout flow',
            'run-1'
        );
        expect(payload).toMatchObject({
            pagination: {
                page: 1,
                limit: 20,
                total: 1,
                totalPages: 1,
            }
        });
        expect(payload.records).toHaveLength(1);
        expect(payload.records[0]).toMatchObject({
            id: 'usage-1',
            aiActions: 4,
        });
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isProjectMember: vi.fn(),
    isTestCaseProjectMember: vi.fn(),
    testRunFindFirst: vi.fn(),
    testRunFindMany: vi.fn(),
    queryRaw: vi.fn(),
    testRunEventFindMany: vi.fn(),
    getSignedDownloadUrl: vi.fn(),
}));

vi.mock('@/lib/security/permissions', () => ({
    isProjectMember: mocks.isProjectMember,
    isTestCaseProjectMember: mocks.isTestCaseProjectMember,
}));

vi.mock('@/lib/storage/object-store', () => ({
    objectStore: {
        getSignedDownloadUrl: mocks.getSignedDownloadUrl,
    },
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findFirst: mocks.testRunFindFirst,
            findMany: mocks.testRunFindMany,
        },
        $queryRaw: mocks.queryRaw,
        testRunEvent: {
            findMany: mocks.testRunEventFindMany,
        },
    },
}));

const { listTestRuns } = await import('@/lib/mcp/run-query');

describe('listTestRuns', () => {
    beforeEach(() => {
        mocks.isProjectMember.mockReset();
        mocks.isTestCaseProjectMember.mockReset();
        mocks.testRunFindFirst.mockReset();
        mocks.testRunFindMany.mockReset();
        mocks.queryRaw.mockReset();
        mocks.testRunEventFindMany.mockReset();
        mocks.getSignedDownloadUrl.mockReset();

        mocks.isProjectMember.mockResolvedValue(true);
        mocks.isTestCaseProjectMember.mockResolvedValue(true);
        mocks.getSignedDownloadUrl.mockResolvedValue('https://signed.example.com/artifact');
    });

    it('returns forbidden when project access is denied', async () => {
        mocks.isProjectMember.mockResolvedValueOnce(false);

        const result = await listTestRuns('user-1', { projectId: 'project-1' });

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('Expected failure');
        }
        expect(result.failure.error).toBe('Forbidden');
    });

    it('returns runs with events and artifacts when requested', async () => {
        mocks.testRunFindMany.mockResolvedValueOnce([{
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'FAIL',
            error: 'boom',
            requiredCapability: 'BROWSER',
            requestedDeviceId: null,
            startedAt: new Date('2026-03-09T00:00:00.000Z'),
            completedAt: new Date('2026-03-09T00:00:10.000Z'),
            createdAt: new Date('2026-03-09T00:00:00.000Z'),
            files: [{
                storedName: 'runs/run-1/screenshot.png',
                filename: 'screenshot.png',
                mimeType: 'image/png',
                size: 100,
                createdAt: new Date('2026-03-09T00:00:01.000Z'),
            }],
        }]);
        mocks.queryRaw
            .mockResolvedValueOnce([{
                runId: 'run-1',
                sequence: 1,
                kind: 'STEP_LOG',
                message: 'step failed',
                artifactKey: null,
                payload: { type: 'log', data: { message: 'x', level: 'error' }, timestamp: 1 },
                createdAt: new Date('2026-03-09T00:00:05.000Z'),
            }]);
        mocks.testRunEventFindMany
            .mockResolvedValueOnce([{
                runId: 'run-1',
                artifactKey: 'runs/run-1/video.mp4',
                createdAt: new Date('2026-03-09T00:00:06.000Z'),
            }]);

        const result = await listTestRuns('user-1', {
            include: ['events', 'artifacts'],
            limit: 20,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
            throw new Error('Expected success');
        }
        expect(result.data.runs).toHaveLength(1);
        expect(result.data.runs[0]).toMatchObject({
            id: 'run-1',
            status: 'FAIL',
        });
        expect(result.data.runs[0].events).toHaveLength(1);
        expect(result.data.runs[0].artifacts).toHaveLength(2);
        expect(result.data.pagination.nextCursor).toBeNull();
    });
});

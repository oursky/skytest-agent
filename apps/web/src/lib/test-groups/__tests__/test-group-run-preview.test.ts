import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    testGroupFindFirst: vi.fn(),
    testRunFindMany: vi.fn(),
    runSessionFindFirst: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testGroup: { findFirst: mocks.testGroupFindFirst },
        testRun: { findMany: mocks.testRunFindMany },
        runSession: { findFirst: mocks.runSessionFindFirst },
    },
}));

const { getTestGroupRunPreview } = await import('@/lib/test-groups/test-group-service');

describe('getTestGroupRunPreview', () => {
    beforeEach(() => {
        mocks.testGroupFindFirst.mockReset();
        mocks.testRunFindMany.mockReset();
        mocks.runSessionFindFirst.mockReset();
    });

    it('returns null when the group is missing', async () => {
        mocks.testGroupFindFirst.mockResolvedValue(null);
        expect(await getTestGroupRunPreview('project-1', 'missing')).toBeNull();
    });

    it('orders login flows before test cases and maps each latest run', async () => {
        mocks.testGroupFindFirst.mockResolvedValue({
            id: 'group-1',
            name: 'Checkout',
            displayId: 'GP01',
            loginSessions: [
                { loginFlowId: 'lf-b', position: 1, loginFlow: { displayId: 'LF-02', name: 'Login B' } },
                { loginFlowId: 'lf-a', position: 0, loginFlow: { displayId: 'LF-01', name: 'Login A' } },
            ],
            items: [
                { testCaseId: 'tc-2', position: 1, testCase: { displayId: 'TC-02', name: 'Case Two' } },
                { testCaseId: 'tc-1', position: 0, testCase: { displayId: 'TC-01', name: 'Case One' } },
            ],
        });
        mocks.testRunFindMany.mockResolvedValue([
            { testCaseId: 'tc-1', status: 'PASS', startedAt: new Date('2026-06-23T10:00:00Z'), createdAt: new Date('2026-06-23T10:00:00Z') },
            { testCaseId: 'tc-1', status: 'FAIL', startedAt: new Date('2026-06-20T10:00:00Z'), createdAt: new Date('2026-06-20T10:00:00Z') },
            { testCaseId: 'lf-a', status: 'PASS', startedAt: null, createdAt: new Date('2026-06-22T09:00:00Z') },
        ]);
        mocks.runSessionFindFirst.mockResolvedValue({ id: 'sess-9', status: 'RUNNING' });

        const preview = await getTestGroupRunPreview('project-1', 'group-1');

        expect(preview).not.toBeNull();
        expect(preview!.members.map((m) => m.testCaseId)).toEqual(['lf-a', 'lf-b', 'tc-1', 'tc-2']);
        expect(preview!.members.map((m) => m.kind)).toEqual(['LOGIN_FLOW', 'LOGIN_FLOW', 'TEST', 'TEST']);
        expect(preview!.members.map((m) => m.position)).toEqual([0, 1, 2, 3]);
        // Latest run wins for tc-1; falls back to createdAt when startedAt is null (lf-a).
        expect(preview!.members.find((m) => m.testCaseId === 'tc-1')).toMatchObject({ status: 'PASS', startedAt: '2026-06-23T10:00:00.000Z' });
        expect(preview!.members.find((m) => m.testCaseId === 'lf-a')).toMatchObject({ status: 'PASS', startedAt: '2026-06-22T09:00:00.000Z' });
        // Never-run cases report no status/start.
        expect(preview!.members.find((m) => m.testCaseId === 'tc-2')).toMatchObject({ status: null, startedAt: null });
        expect(preview!.activeSessionId).toBe('sess-9');
        expect(preview!.activeSessionStatus).toBe('RUNNING');
    });
});

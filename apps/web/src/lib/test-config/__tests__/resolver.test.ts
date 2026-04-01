import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    projectConfigFindMany: vi.fn(),
    testCaseConfigFindMany: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        projectConfig: {
            findMany: mocks.projectConfigFindMany,
        },
        testCaseConfig: {
            findMany: mocks.testCaseConfigFindMany,
        },
    },
}));

const { resolveConfigs } = await import('@/lib/test-config/resolver');

describe('resolveConfigs random string generation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-01T09:08:07.456'));

        mocks.projectConfigFindMany.mockReset();
        mocks.testCaseConfigFindMany.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('generates TIMESTAMP_DATETIME values in YYYYMMDDhhmmss format without milliseconds', async () => {
        mocks.projectConfigFindMany.mockResolvedValue([
            {
                name: 'TS_1',
                type: 'RANDOM_STRING',
                value: 'TIMESTAMP_DATETIME',
                masked: false,
                group: null,
                filename: null,
                createdAt: new Date('2026-04-01T09:00:00.000'),
            },
            {
                name: 'TS_2',
                type: 'RANDOM_STRING',
                value: 'TIMESTAMP_DATETIME',
                masked: false,
                group: null,
                filename: null,
                createdAt: new Date('2026-04-01T09:00:01.000'),
            },
        ]);
        mocks.testCaseConfigFindMany.mockResolvedValue([]);

        const resolved = await resolveConfigs('project-1');

        expect(resolved.variables.TS_1).toBe('20260401090807');
        expect(resolved.variables.TS_2).toBe('20260401090808');
        expect(resolved.variables.TS_1).toMatch(/^\d{14}$/);
        expect(resolved.variables.TS_2).toMatch(/^\d{14}$/);
    });
});

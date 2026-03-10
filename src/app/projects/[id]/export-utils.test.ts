import { describe, expect, it } from 'vitest';

import { buildExportRowsSortedByIdAsc } from './export-utils';

describe('buildExportRowsSortedByIdAsc', () => {
    it('sorts exported rows by ID in ascending order', () => {
        const rows = buildExportRowsSortedByIdAsc([
            {
                displayId: 'TC-10',
                name: 'tenth case',
                status: 'PASS',
                updatedAt: '2026-03-10T00:00:00.000Z',
                testRuns: [],
            },
            {
                displayId: 'TC-01',
                name: 'first case',
                status: 'FAIL',
                updatedAt: '2026-03-10T00:00:00.000Z',
                testRuns: [],
            },
            {
                displayId: 'TC-02',
                name: 'second case',
                status: 'PASS',
                updatedAt: '2026-03-10T00:00:00.000Z',
                testRuns: [],
            },
        ]);

        expect(rows.map((row) => row[0])).toEqual(['TC-01', 'TC-02', 'TC-10']);
    });
});

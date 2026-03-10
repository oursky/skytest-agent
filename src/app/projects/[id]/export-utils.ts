interface ExportTestRun {
    status: string;
}

export interface ExportableTestCase {
    displayId?: string;
    status?: string;
    name: string;
    updatedAt: string;
    testRuns: ExportTestRun[];
}

export function buildExportRowsSortedByIdAsc(testCases: ExportableTestCase[]): string[][] {
    return [...testCases]
        .sort((a, b) => {
            const idA = a.displayId || '';
            const idB = b.displayId || '';
            return idA.localeCompare(idB);
        })
        .map((testCase) => {
            const status = testCase.testRuns[0]?.status || testCase.status || '';
            return [
                testCase.displayId || '',
                testCase.name,
                status,
                testCase.updatedAt,
            ];
        });
}

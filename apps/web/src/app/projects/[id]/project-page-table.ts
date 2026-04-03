import type { SortColumn, TestCase } from './project-page.types';

export function filterProjectTestCases(testCases: TestCase[], searchQuery: string): TestCase[] {
    if (!searchQuery.trim()) {
        return testCases;
    }

    const query = searchQuery.toLowerCase();
    return testCases.filter((testCase) => {
        const matchesId = testCase.displayId?.toLowerCase().includes(query);
        const matchesName = testCase.name.toLowerCase().includes(query);
        return matchesId || matchesName;
    });
}

export function sortProjectTestCases(
    testCases: TestCase[],
    sortColumn: SortColumn,
    sortDirection: 'asc' | 'desc'
): TestCase[] {
    const sorted = [...testCases].sort((a, b) => {
        let comparison = 0;

        switch (sortColumn) {
            case 'id': {
                const idA = a.displayId || '';
                const idB = b.displayId || '';
                comparison = idA.localeCompare(idB);
                break;
            }
            case 'name':
                comparison = a.name.localeCompare(b.name);
                break;
            case 'status': {
                const statusA = a.testRuns[0]?.status || a.status || '';
                const statusB = b.testRuns[0]?.status || b.status || '';
                comparison = statusA.localeCompare(statusB);
                break;
            }
            case 'updated':
                comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
                break;
        }

        return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
}

export function toggleSelectAllFilteredTestCases(input: {
    previous: Set<string>;
    sortedTestCases: TestCase[];
    allFilteredSelected: boolean;
}): Set<string> {
    const next = new Set(input.previous);

    if (input.allFilteredSelected) {
        input.sortedTestCases.forEach((testCase) => next.delete(testCase.id));
    } else {
        input.sortedTestCases.forEach((testCase) => next.add(testCase.id));
    }

    return next;
}

export function toggleSelectedTestCase(previous: Set<string>, testCaseId: string): Set<string> {
    const next = new Set(previous);
    if (next.has(testCaseId)) {
        next.delete(testCaseId);
    } else {
        next.add(testCaseId);
    }
    return next;
}

import type { TestCaseTargetSummary } from '@/types';

export interface TestGroupTestCaseOption {
    id: string;
    displayId?: string | null;
    name: string;
    targets?: TestCaseTargetSummary[];
}

export function toggleSelectedTestCase(selectedIds: string[], testCaseId: string, checked: boolean): string[] {
    if (checked) {
        return selectedIds.includes(testCaseId) ? selectedIds : [...selectedIds, testCaseId];
    }
    return selectedIds.filter((id) => id !== testCaseId);
}

export function toggleVisibleTestCases(selectedIds: string[], visibleIds: string[], checked: boolean): string[] {
    if (checked) {
        const next = new Set(selectedIds);
        visibleIds.forEach((id) => next.add(id));
        return Array.from(next);
    }
    const visible = new Set(visibleIds);
    return selectedIds.filter((id) => !visible.has(id));
}

export function moveSelectedTestCase(selectedIds: string[], testCaseId: string, delta: -1 | 1): string[] {
    const index = selectedIds.indexOf(testCaseId);
    const targetIndex = index + delta;
    if (index < 0 || targetIndex < 0 || targetIndex >= selectedIds.length) {
        return selectedIds;
    }
    const next = [...selectedIds];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

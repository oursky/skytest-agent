import { describe, expect, it } from 'vitest';
import { resolveSnapshotTestCaseIdentity } from './snapshot-utils';

describe('resolveSnapshotTestCaseIdentity', () => {
    it('uses canonical snapshot fields when present', () => {
        const result = resolveSnapshotTestCaseIdentity({
            displayId: 'TC-100',
            name: 'Checkout flow',
            fallbackDisplayId: 'TC-OLD',
            fallbackName: 'Old name',
        });

        expect(result).toEqual({
            displayId: 'TC-100',
            name: 'Checkout flow',
        });
    });

    it('falls back when snapshot fields are missing or blank', () => {
        const result = resolveSnapshotTestCaseIdentity({
            displayId: '   ',
            name: '',
            fallbackDisplayId: 'TC-300',
            fallbackName: 'Fallback flow',
        });

        expect(result).toEqual({
            displayId: 'TC-300',
            name: 'Fallback flow',
        });
    });
});

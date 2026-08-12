import { describe, expect, it } from 'vitest';
import {
    moveSelectedTestCase,
    toggleSelectedTestCase,
    toggleVisibleTestCases,
} from '@/components/features/test-groups/model/test-case-selection';

describe('test-group test-case selection', () => {
    it('appends newly selected cases without duplicating existing cases', () => {
        expect(toggleSelectedTestCase(['a', 'b'], 'c', true)).toEqual(['a', 'b', 'c']);
        expect(toggleSelectedTestCase(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    });

    it('removes a case while preserving the remaining run order', () => {
        expect(toggleSelectedTestCase(['a', 'b', 'c'], 'b', false)).toEqual(['a', 'c']);
    });

    it('selects visible cases at the end in their table order', () => {
        expect(toggleVisibleTestCases(['b'], ['a', 'b', 'c'], true)).toEqual(['b', 'a', 'c']);
    });

    it('clears only cases visible on the current page', () => {
        expect(toggleVisibleTestCases(['a', 'b', 'c'], ['b', 'd'], false)).toEqual(['a', 'c']);
    });

    it('moves a selected case within the global run order', () => {
        expect(moveSelectedTestCase(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
        expect(moveSelectedTestCase(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
        expect(moveSelectedTestCase(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    });
});

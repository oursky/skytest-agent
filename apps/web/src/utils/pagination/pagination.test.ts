import { describe, expect, it } from 'vitest';
import { extractListData } from '@/utils/pagination/pagination';

describe('extractListData', () => {
    it('returns a bare array payload as-is', () => {
        expect(extractListData<number>([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('unwraps a paginated { data } envelope', () => {
        expect(extractListData<number>({ data: [1, 2], pagination: { total: 2 } })).toEqual([1, 2]);
    });

    it('returns [] for an error object, null, or an unexpected shape', () => {
        expect(extractListData({ error: 'nope' })).toEqual([]);
        expect(extractListData(null)).toEqual([]);
        expect(extractListData(undefined)).toEqual([]);
        expect(extractListData('not-a-list')).toEqual([]);
        expect(extractListData({ data: { not: 'an array' } })).toEqual([]);
    });
});

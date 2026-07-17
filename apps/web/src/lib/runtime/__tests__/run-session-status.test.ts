import { describe, expect, it } from 'vitest';
import { rollupRunSessionStatus } from '@/lib/runtime/run-session-status';
import { TEST_STATUS } from '@/types';

describe('rollupRunSessionStatus', () => {
    it('is QUEUED when there are no members', () => {
        expect(rollupRunSessionStatus([])).toBe(TEST_STATUS.QUEUED);
    });

    it('is QUEUED when every member is queued', () => {
        expect(rollupRunSessionStatus([TEST_STATUS.QUEUED, TEST_STATUS.QUEUED])).toBe(TEST_STATUS.QUEUED);
    });

    it('is FAIL when all members settled and any failed', () => {
        expect(rollupRunSessionStatus([TEST_STATUS.PASS, TEST_STATUS.FAIL, TEST_STATUS.CANCELLED])).toBe(TEST_STATUS.FAIL);
    });

    it('stays RUNNING after a failure while members are still queued or executing (CONTINUE mode)', () => {
        expect(rollupRunSessionStatus([TEST_STATUS.PASS, TEST_STATUS.FAIL, TEST_STATUS.QUEUED])).toBe(TEST_STATUS.RUNNING);
        expect(rollupRunSessionStatus([TEST_STATUS.FAIL, TEST_STATUS.RUNNING])).toBe(TEST_STATUS.RUNNING);
        expect(rollupRunSessionStatus([TEST_STATUS.FAIL, TEST_STATUS.PREPARING])).toBe(TEST_STATUS.RUNNING);
        expect(rollupRunSessionStatus([TEST_STATUS.CANCELLED, TEST_STATUS.QUEUED])).toBe(TEST_STATUS.RUNNING);
    });

    it('prefers FAIL over CANCELLED', () => {
        expect(rollupRunSessionStatus([TEST_STATUS.CANCELLED, TEST_STATUS.FAIL])).toBe(TEST_STATUS.FAIL);
    });

    it('is CANCELLED when a member was cancelled and none failed', () => {
        expect(rollupRunSessionStatus([TEST_STATUS.PASS, TEST_STATUS.CANCELLED])).toBe(TEST_STATUS.CANCELLED);
    });

    it('is RUNNING while a member is preparing or running', () => {
        expect(rollupRunSessionStatus([TEST_STATUS.PASS, TEST_STATUS.RUNNING])).toBe(TEST_STATUS.RUNNING);
        expect(rollupRunSessionStatus([TEST_STATUS.PREPARING, TEST_STATUS.QUEUED])).toBe(TEST_STATUS.RUNNING);
    });

    it('is RUNNING when some members are done but others are still queued', () => {
        expect(rollupRunSessionStatus([TEST_STATUS.PASS, TEST_STATUS.QUEUED])).toBe(TEST_STATUS.RUNNING);
    });

    it('is PASS when every member passed', () => {
        expect(rollupRunSessionStatus([TEST_STATUS.PASS, TEST_STATUS.PASS])).toBe(TEST_STATUS.PASS);
    });
});

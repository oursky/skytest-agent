import { describe, expect, it } from 'vitest';
import { buildRetryPolicyOptions } from '@/components/features/test-groups/ui/TestGroupEditor';
import { TEST_GROUP_RETRY_POLICY } from '@/types';

describe('TestGroupEditor retry policy descriptions', () => {
    it('provides a dedicated description for every retry policy', () => {
        const options = buildRetryPolicyOptions((key) => key);

        expect(options[TEST_GROUP_RETRY_POLICY.NONE].description).toBe('testGroup.retryPolicy.none.description');
        expect(options[TEST_GROUP_RETRY_POLICY.FAILED_ONCE].description).toBe('testGroup.retryPolicy.failedOnce.description');
        expect(options[TEST_GROUP_RETRY_POLICY.FAILED_TWICE].description).toBe('testGroup.retryPolicy.failedTwice.description');
        expect(options[TEST_GROUP_RETRY_POLICY.WHOLE_GROUP_ONCE].description).toBe('testGroup.retryPolicy.wholeGroupOnce.description');
    });
});

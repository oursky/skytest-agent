import { describe, expect, it } from 'vitest';
import { createRequestIdGuard } from '@/hooks/team/request-id-guard';

describe('request-id-guard', () => {
    it('treats only the latest request as valid during fast repeated switches/deletes', () => {
        const guard = createRequestIdGuard();
        const firstSwitchRequest = guard.next();
        const secondDeleteRequest = guard.next();
        const thirdSwitchRequest = guard.next();

        expect(guard.isLatest(firstSwitchRequest)).toBe(false);
        expect(guard.isLatest(secondDeleteRequest)).toBe(false);
        expect(guard.isLatest(thirdSwitchRequest)).toBe(true);
    });
});

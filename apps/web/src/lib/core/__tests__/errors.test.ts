import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '@/lib/core/errors';

describe('getErrorMessage', () => {
    it('strips ANSI control sequences from error text', () => {
        const message = getErrorMessage('\u001b[31mError:\u001b[39m boom');
        expect(message).toBe('boom');
    });
});

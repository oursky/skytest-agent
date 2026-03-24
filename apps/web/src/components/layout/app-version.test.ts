import { describe, expect, it } from 'vitest';

import { resolveConsoleAppVersion } from './app-version';

describe('resolveConsoleAppVersion', () => {
    it('returns configured version when present', () => {
        expect(resolveConsoleAppVersion('1.2.3', 'localhost')).toBe('1.2.3');
    });

    it('returns local-dev on localhost when version is missing', () => {
        expect(resolveConsoleAppVersion(undefined, 'localhost')).toBe('local-dev');
    });

    it('returns unknown on non-localhost when version is missing', () => {
        expect(resolveConsoleAppVersion(undefined, 'app.skytest.io')).toBe('unknown');
    });
});

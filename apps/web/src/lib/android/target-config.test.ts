import { describe, expect, it } from 'vitest';
import { isAndroidTargetConfig } from '@/lib/android/target-config';
import type { BrowserConfig, TargetConfig } from '@/types';

describe('isAndroidTargetConfig', () => {
    it('identifies android target configs', () => {
        const config = {
            type: 'android',
            deviceSelector: { mode: 'connected-device', serial: 'abc' },
        } as unknown as TargetConfig;
        expect(isAndroidTargetConfig(config)).toBe(true);
    });

    it('treats browser configs as non-android', () => {
        const config = { name: 'main', width: 1280, height: 720 } as BrowserConfig;
        expect(isAndroidTargetConfig(config)).toBe(false);
    });

    it('returns false for non-object values without throwing', () => {
        const stringified = JSON.stringify({ type: 'android' }, null, 2) as unknown as BrowserConfig;
        expect(isAndroidTargetConfig(stringified)).toBe(false);
        expect(isAndroidTargetConfig(null as unknown as BrowserConfig)).toBe(false);
        expect(isAndroidTargetConfig(undefined as unknown as BrowserConfig)).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';
import {
    buildHostResourceKey,
    isEmulatorProfileDeviceId,
    resolveAndroidResourceType,
} from '@/lib/runners/android-resource-lock';

describe('android-resource-lock helpers', () => {
    it('builds connected-device resource key for physical device serials', () => {
        expect(buildHostResourceKey('R58M123456A')).toBe('connected-device:R58M123456A');
        expect(isEmulatorProfileDeviceId('R58M123456A')).toBe(false);
        expect(resolveAndroidResourceType('R58M123456A')).toBe('CONNECTED_DEVICE');
    });

    it('keeps emulator-profile resource key unchanged for emulator profiles', () => {
        expect(buildHostResourceKey('emulator-profile:Pixel_8_API_35')).toBe('emulator-profile:Pixel_8_API_35');
        expect(isEmulatorProfileDeviceId('emulator-profile:Pixel_8_API_35')).toBe(true);
        expect(resolveAndroidResourceType('emulator-profile:Pixel_8_API_35')).toBe('EMULATOR_PROFILE');
    });
});

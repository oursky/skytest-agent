import { describe, expect, it } from 'vitest';
import { EN_MESSAGES } from '@/i18n/locales/en/index';
import { ZH_HANS_MESSAGES } from '@/i18n/locales/zh-hans/index';
import { ZH_HANT_MESSAGES } from '@/i18n/locales/zh-hant/index';

describe('locale message assembly', () => {
    it('assembles the same complete key set for every locale', () => {
        const englishKeys = Object.keys(EN_MESSAGES).sort();

        expect(Object.keys(ZH_HANS_MESSAGES).sort()).toEqual(englishKeys);
        expect(Object.keys(ZH_HANT_MESSAGES).sort()).toEqual(englishKeys);
        expect(englishKeys).toContain('testGroup.retryPolicy.wholeGroupOnce.description');
    });
});

export const LOCALE_META = {
    en: { label: 'EN', htmlLang: 'en' },
    'zh-Hant': { label: '繁中', htmlLang: 'zh-Hant' },
    'zh-Hans': { label: '简中', htmlLang: 'zh-Hans' }
} as const;

export type Locale = keyof typeof LOCALE_META;

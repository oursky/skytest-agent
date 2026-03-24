import type { Locale } from './locale-meta';
import type { Messages } from './types';

export async function loadLocaleMessages(locale: Locale): Promise<Messages> {
    if (locale === 'en') {
        const localeModule = await import('./locales/en');
        return localeModule.EN_MESSAGES;
    }

    if (locale === 'zh-Hant') {
        const localeModule = await import('./locales/zh-hant');
        return localeModule.ZH_HANT_MESSAGES;
    }

    const localeModule = await import('./locales/zh-hans');
    return localeModule.ZH_HANS_MESSAGES;
}

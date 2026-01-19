'use client';

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { LOCALE_META, Locale, MESSAGES, TranslationVars } from './messages';

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, vars?: TranslationVars) => string;
}

const STORAGE_KEY = 'skyt_locale';
const COOKIE_KEY = 'skyt_locale';

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function isLocale(value: string): value is Locale {
  return Object.prototype.hasOwnProperty.call(LOCALE_META, value);
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').map((c) => c.trim());
  for (const c of cookies) {
    if (c.startsWith(`${name}=`)) {
      return decodeURIComponent(c.slice(name.length + 1));
    }
  }
  return null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}; path=/`;
}

function detectClientPreferredLocale(): Locale {
  const cookieLocale = readCookie(COOKIE_KEY);
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && isLocale(stored)) return stored;

  const nav = navigator.language;
  const lower = nav.toLowerCase();
  if (lower.startsWith('zh')) {
    if (lower.includes('hant') || nav.includes('TW') || nav.includes('HK') || nav.includes('MO')) {
      return 'zh-Hant';
    }
    return 'zh-Hans';
  }

  return 'en';
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

export function I18nProvider({
  children,
  initialLocale
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? 'en');

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    writeCookie(COOKIE_KEY, next);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = LOCALE_META[locale].htmlLang;
  }, [locale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const preferred = detectClientPreferredLocale();
    if (preferred !== locale) {
      setLocale(preferred);
      return;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      window.localStorage.setItem(STORAGE_KEY, locale);
    }

    const cookieLocale = readCookie(COOKIE_KEY);
    if (!cookieLocale) {
      writeCookie(COOKIE_KEY, locale);
    }
  }, [locale, setLocale]);

  const t = useCallback(
    (key: string, vars?: TranslationVars) => {
      const message = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
      return interpolate(message, vars);
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}

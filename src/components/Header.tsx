'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { LOCALE_META, Locale, useI18n } from '@/i18n';

export default function Header() {
    const { isLoggedIn, isLoading: isAuthLoading, user, logout, openSettings, login } = useAuth();
    const router = useRouter();
    const { locale, setLocale, t } = useI18n();

    const localeOptions = useMemo(() => Object.keys(LOCALE_META) as Locale[], []);

    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const [isLanguageOpen, setIsLanguageOpen] = useState(false);
    const [languageFocusIndex, setLanguageFocusIndex] = useState(0);
    const languageButtonRef = useRef<HTMLButtonElement | null>(null);
    const languageMenuRef = useRef<HTMLDivElement | null>(null);
    const languageOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

    useEffect(() => {
        const closeDropdown = () => {
            if (isDropdownOpen) setIsDropdownOpen(false);
        };
        if (isDropdownOpen) document.addEventListener('click', closeDropdown);
        return () => document.removeEventListener('click', closeDropdown);
    }, [isDropdownOpen]);

    useEffect(() => {
        if (!isLanguageOpen) return;
        const rafId = window.requestAnimationFrame(() => {
            languageOptionRefs.current[languageFocusIndex]?.focus();
        });
        return () => window.cancelAnimationFrame(rafId);
    }, [isLanguageOpen, languageFocusIndex]);

    useEffect(() => {
        if (!isLanguageOpen) return;

        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (languageMenuRef.current?.contains(target)) return;
            if (languageButtonRef.current?.contains(target)) return;
            setIsLanguageOpen(false);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (!isLanguageOpen) return;
            if (e.key === 'Escape') {
                setIsLanguageOpen(false);
                languageButtonRef.current?.focus();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setLanguageFocusIndex((i) => Math.min(localeOptions.length - 1, i + 1));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setLanguageFocusIndex((i) => Math.max(0, i - 1));
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const selected = localeOptions[languageFocusIndex];
                if (selected) setLocale(selected);
                setIsLanguageOpen(false);
                languageButtonRef.current?.focus();
            }
        };

        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isLanguageOpen, languageFocusIndex, localeOptions, setLocale]);

    const handleLogout = async () => {
        await logout();
        router.push('/');
    };

    const handleBrandClick = () => {
        router.push(isLoggedIn ? '/projects' : '/');
    };

    return (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-8 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleBrandClick}
                            className="text-xl font-bold text-blue-600 hover:text-blue-700 transition-colors"
                        >
                            SkyTest Agent
                        </button>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <span className="sr-only" id="language-label">
                                {t('header.language')}
                            </span>
                            <button
                                ref={languageButtonRef}
                                type="button"
                                aria-haspopup="listbox"
                                aria-expanded={isLanguageOpen}
                                aria-labelledby="language-label"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsDropdownOpen(false);
                                    setIsLanguageOpen((open) => {
                                        const nextOpen = !open;
                                        if (nextOpen) {
                                            setLanguageFocusIndex(Math.max(0, localeOptions.indexOf(locale)));
                                        }
                                        return nextOpen;
                                    });
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setIsDropdownOpen(false);
                                        setLanguageFocusIndex(Math.max(0, localeOptions.indexOf(locale)));
                                        setIsLanguageOpen(true);
                                    }
                                }}
                                className="h-9 px-3 text-sm text-gray-700 border border-gray-200 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 inline-flex items-center gap-2"
                            >
                                <span className="font-medium">{LOCALE_META[locale].label}</span>
                                <svg
                                    className={`w-4 h-4 text-gray-400 transition-transform ${isLanguageOpen ? 'rotate-180' : ''}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {isLanguageOpen && (
                                <div
                                    ref={languageMenuRef}
                                    role="listbox"
                                    aria-labelledby="language-label"
                                    className="absolute right-0 top-full mt-2 w-28 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {localeOptions.map((l, index) => (
                                        <button
                                            key={l}
                                            ref={(el) => {
                                                languageOptionRefs.current[index] = el;
                                            }}
                                            type="button"
                                            role="option"
                                            aria-selected={l === locale}
                                            onMouseEnter={() => setLanguageFocusIndex(index)}
                                            onClick={() => {
                                                setLocale(l);
                                                setIsLanguageOpen(false);
                                                languageButtonRef.current?.focus();
                                            }}
                                            className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-gray-50 ${l === locale ? 'text-blue-600 font-semibold' : 'text-gray-700'}`}
                                        >
                                            <span>{LOCALE_META[l].label}</span>
                                            {l === locale && (
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {isLoggedIn ? (
                            <div className="relative">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsLanguageOpen(false);
                                        setIsDropdownOpen(!isDropdownOpen);
                                    }}
                                    className="flex items-center gap-2 hover:bg-gray-50 p-2 rounded-lg transition-colors focus:outline-none"
                                >
                                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
                                        {(user?.email?.[0] || 'U').toUpperCase()}
                                    </div>
                                    <span className="text-sm font-medium text-gray-700 max-w-[150px] truncate hidden md:block">
                                        {user?.email || 'User'}
                                    </span>
                                    <svg
                                        className={`w-4 h-4 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>

                                {isDropdownOpen && (
                                    <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-100 py-2 z-50">
                                        <button
                                            onClick={() => openSettings()}
                                            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                            {t('header.accountSettings')}
                                        </button>

                                        <button
                                            onClick={() => router.push('/usage')}
                                            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                            {t('header.apiKeyUsage')}
                                        </button>

                                        <div className="border-t border-gray-50 mt-1 pt-1">
                                            <button
                                                onClick={handleLogout}
                                                className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                            >
                                                {t('header.logout')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={() => login()}
                                disabled={isAuthLoading}
                                className="h-9 px-3 text-sm font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {t('landing.loginToStart')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}

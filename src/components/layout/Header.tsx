'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { CustomSelect } from '@/components/shared';
import { LOCALE_META, Locale, useI18n } from '@/i18n';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

export default function Header() {
    const { isLoggedIn, isLoading: isAuthLoading, user, logout, openSettings, login, getAccessToken } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const { locale, setLocale, t } = useI18n();
    const { organizations } = useOrganizations(getAccessToken, isLoggedIn);
    const { currentOrganization, setCurrentOrganization } = useCurrentOrganization(getAccessToken, isLoggedIn);

    const localeOptions = useMemo(() => Object.keys(LOCALE_META) as Locale[], []);

    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    useEffect(() => {
        const closeDropdown = () => {
            if (isDropdownOpen) setIsDropdownOpen(false);
        };
        if (isDropdownOpen) document.addEventListener('click', closeDropdown);
        return () => document.removeEventListener('click', closeDropdown);
    }, [isDropdownOpen]);

    const handleLogout = async () => {
        await logout();
        router.push('/');
    };

    const handleBrandClick = () => {
        router.push(isLoggedIn ? '/projects' : '/');
    };

    const handleOrganizationChange = async (organizationId: string) => {
        try {
            await setCurrentOrganization(organizationId);
            if (pathname === '/projects') {
                router.refresh();
            }
        } catch (error) {
            console.error('Failed to switch organization', error);
        }
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
                        {isLoggedIn ? (
                            <div className="relative">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
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
                                            onClick={() => router.push('/mcp')}
                                            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                            {t('header.connectMcp')}
                                        </button>

                                        <button
                                            onClick={() => router.push('/teams')}
                                            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                            {t('header.myTeams')}
                                        </button>

                                        <div className="border-t border-gray-50 mt-1 pt-1">
                                            <button
                                                onClick={handleLogout}
                                                className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                            >
                                                {t('header.logout')}
                                            </button>
                                        </div>

                                        <div className="border-t border-gray-50 mt-2 px-4 pt-3">
                                            <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                                                {t('header.language')}
                                            </div>
                                            <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">
                                                {localeOptions.map((option) => (
                                                    <button
                                                        key={option}
                                                        type="button"
                                                        onClick={() => setLocale(option)}
                                                        className={`rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${option === locale ? 'bg-white text-primary shadow-sm' : 'text-gray-600 hover:bg-white/70'}`}
                                                    >
                                                        {LOCALE_META[option].label}
                                                    </button>
                                                ))}
                                            </div>
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

                        {isLoggedIn && organizations.length > 0 && (
                            <CustomSelect
                                value={currentOrganization?.id ?? organizations[0]?.id ?? ''}
                                options={organizations.map((organization) => ({
                                    value: organization.id,
                                    label: organization.name,
                                }))}
                                onChange={(organizationId) => void handleOrganizationChange(organizationId)}
                                ariaLabel={t('header.organization')}
                                buttonClassName="h-9 min-w-44 border-gray-200 px-3 focus:ring-blue-500"
                                menuClassName="min-w-44"
                            />
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}

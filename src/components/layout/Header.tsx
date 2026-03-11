'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { CustomSelect, Modal } from '@/components/shared';
import { LOCALE_META, Locale, useI18n } from '@/i18n';
import { useTeams } from '@/hooks/useTeams';
import { useCurrentTeam } from '@/hooks/useCurrentTeam';
import { useCreateTeam } from '@/hooks/useCreateTeam';

export default function Header() {
    const { isLoggedIn, isLoading: isAuthLoading, user, logout, openSettings, login, getAccessToken } = useAuth();
    const router = useRouter();
    const { locale, setLocale, t } = useI18n();
    const { teams, refresh: refreshTeams } = useTeams(getAccessToken, isLoggedIn);
    const { currentTeam, setCurrentTeam } = useCurrentTeam(getAccessToken, isLoggedIn);

    const localeOptions = useMemo(() => Object.keys(LOCALE_META) as Locale[], []);

    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');
    const { createTeam, isSubmitting: isCreateTeamSubmitting } = useCreateTeam({
        getAccessToken,
        refreshTeams,
        setCurrentTeam,
    });

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

    const handleTeamChange = async (teamId: string) => {
        try {
            await setCurrentTeam(teamId);
        } catch (error) {
            console.error('Failed to switch team', error);
        }
    };

    const handleCreateTeamSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!newTeamName.trim()) {
            return;
        }

        const result = await createTeam(newTeamName, 'Failed to create team');
        if (!result.teamId) {
            console.error(result.error ?? 'Failed to create team');
            return;
        }

        setNewTeamName('');
        setIsCreateTeamOpen(false);
        router.push(`/projects?teamId=${encodeURIComponent(result.teamId)}`);
    };

    return (
        <>
            <Modal
                isOpen={isCreateTeamOpen}
                onClose={() => {
                    setIsCreateTeamOpen(false);
                    setNewTeamName('');
                }}
                title={t('team.page.create.open')}
                closeOnConfirm={false}
                showFooter={false}
                panelClassName="max-w-lg"
            >
                <form onSubmit={handleCreateTeamSubmit} className="space-y-4">
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('team.page.settings.name')}</span>
                        <input
                            type="text"
                            value={newTeamName}
                            onChange={(event) => setNewTeamName(event.target.value)}
                            placeholder={t('team.page.create.placeholder')}
                            className="w-full rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                            autoFocus
                        />
                    </label>
                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            onClick={() => {
                                setIsCreateTeamOpen(false);
                                setNewTeamName('');
                            }}
                            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={isCreateTeamSubmitting || !newTeamName.trim()}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                        >
                            {t('team.page.create.confirm')}
                        </button>
                    </div>
                </form>
            </Modal>

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

                        <div className="flex items-center gap-3">
                            {isLoggedIn ? (
                                <div className="flex items-center gap-3">
                                    {teams.length > 0 && (
                                        <CustomSelect
                                            value={currentTeam?.id ?? teams[0]?.id ?? ''}
                                            options={teams.map((team) => ({
                                                value: team.id,
                                                label: team.name,
                                            }))}
                                            onChange={(teamId) => void handleTeamChange(teamId)}
                                            ariaLabel={t('header.team')}
                                            buttonClassName="h-9 min-w-40 lg:min-w-56 border-gray-200 px-3 focus:ring-blue-500"
                                            menuClassName="min-w-40 lg:min-w-56"
                                            footerActionLabel={t('header.addTeam')}
                                            onFooterAction={() => {
                                                setIsCreateTeamOpen(true);
                                                setNewTeamName('');
                                            }}
                                        />
                                    )}

                                    <div className="relative">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setIsDropdownOpen(!isDropdownOpen);
                                            }}
                                            className="flex items-center gap-2 rounded-lg p-2 transition-colors hover:bg-gray-50 focus:outline-none"
                                        >
                                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold text-white">
                                                {(user?.email?.[0] || 'U').toUpperCase()}
                                            </div>
                                            <span className="hidden max-w-[180px] truncate text-sm font-medium text-gray-700 md:block">
                                                {user?.email || 'User'}
                                            </span>
                                            <svg
                                                className={`h-4 w-4 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </button>

                                        {isDropdownOpen && (
                                            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-gray-100 bg-white py-2 shadow-lg">
                                                <button
                                                    onClick={() => openSettings()}
                                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                                >
                                                    {t('header.accountSettings')}
                                                </button>

                                                <button
                                                    onClick={() => router.push('/teams')}
                                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                                >
                                                    {t('header.myTeams')}
                                                </button>

                                                <button
                                                    onClick={() => router.push('/mcp')}
                                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                                >
                                                    {t('header.connectMcp')}
                                                </button>

                                                <div className="mt-2 border-t border-gray-50 px-4 pt-3">
                                                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">
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

                                                <div className="mt-2 border-t border-gray-50 pt-1">
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
        </>
    );
}

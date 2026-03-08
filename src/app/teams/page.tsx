'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { Modal } from '@/components/shared';
import TeamAiSettings from '@/components/features/team-ai/ui/TeamAiSettings';
import TeamMembers from '@/components/features/team-members/ui/TeamMembers';
import TeamUsage from '@/components/features/team-usage/ui/TeamUsage';
import { TeamRunners } from '@/components/features/team-runners';
import { useCurrentTeam } from '@/hooks/useCurrentTeam';
import { dispatchTeamsChanged, useTeams } from '@/hooks/useTeams';
import { useI18n } from '@/i18n';

interface TeamDetails {
    id: string;
    name: string;
    role: 'OWNER' | 'MEMBER';
    canRename: boolean;
    canDelete: boolean;
    canTransferOwnership: boolean;
}

interface TeamMemberOption {
    id: string;
    userId: string | null;
    email: string | null;
    role: 'OWNER' | 'MEMBER';
}

type TeamTab = 'api' | 'members' | 'runners' | 'settings';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveTeamTab(value: string | null): TeamTab {
    if (value === 'members' || value === 'settings' || value === 'runners') {
        return value;
    }

    return 'api';
}

export default function TeamsPage() {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { t } = useI18n();
    const { teams, loading: areTeamsLoading, refresh: refreshTeams } = useTeams(getAccessToken, isLoggedIn);
    const {
        currentTeam: selectedTeam,
        loading: isCurrentTeamLoading,
        setCurrentTeam,
    } = useCurrentTeam(getAccessToken, isLoggedIn);
    const [teamDetails, setTeamDetails] = useState<TeamDetails | null>(null);
    const [transferCandidates, setTransferCandidates] = useState<TeamMemberOption[]>([]);
    const [renameValue, setRenameValue] = useState('');
    const [transferEmail, setTransferEmail] = useState('');
    const [transferTarget, setTransferTarget] = useState<TeamMemberOption | null>(null);
    const [transferEmailError, setTransferEmailError] = useState<string | null>(null);
    const [isEditingSettings, setIsEditingSettings] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [isTransferOpen, setIsTransferOpen] = useState(false);
    const [deleteConfirmationValue, setDeleteConfirmationValue] = useState('');
    const [error, setError] = useState<string | null>(null);

    const currentTeam = useMemo(() => {
        if (!selectedTeam) {
            return null;
        }

        return teams.find((team) => team.id === selectedTeam.id) ?? null;
    }, [selectedTeam, teams]);

    const eligibleTransferCandidates = useMemo(
        () => transferCandidates.filter((member) => member.role !== 'OWNER' && member.userId && member.email),
        [transferCandidates]
    );

    const loadTeamDetails = useCallback(async (teamId: string) => {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

        const [detailsResponse, membersResponse] = await Promise.all([
            fetch(`/api/teams/${teamId}`, { headers }),
            fetch(`/api/teams/${teamId}/members`, { headers }),
        ]);

        if (!detailsResponse.ok || !membersResponse.ok) {
            throw new Error('Failed to load team details');
        }

        const details = await detailsResponse.json() as TeamDetails;
        const membersData = await membersResponse.json() as { members: TeamMemberOption[] };
        setTeamDetails(details);
        setRenameValue(details.name);
        setIsEditingSettings(false);
        setTransferCandidates(membersData.members);
        setTransferEmail('');
        setTransferEmailError(null);
        setTransferTarget(null);
        setIsTransferOpen(false);
    }, [getAccessToken]);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push('/');
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        if (!isAuthLoading && isLoggedIn && !areTeamsLoading && teams.length === 0) {
            router.push('/welcome');
        }
    }, [areTeamsLoading, isAuthLoading, isLoggedIn, teams.length, router]);

    useEffect(() => {
        if (!currentTeam || teams.length === 0) {
            return;
        }

        queueMicrotask(() => {
            void loadTeamDetails(currentTeam.id).catch(() => {
                setError(t('team.page.error.load'));
            });
        });
    }, [currentTeam, teams.length, loadTeamDetails, t]);

    const activeTab = resolveTeamTab(searchParams.get('tab'));

    const canAccessSettings = teamDetails !== null && (
        teamDetails.canRename ||
        teamDetails.canDelete ||
        teamDetails.canTransferOwnership
    );
    const visibleTab = activeTab === 'settings' && !canAccessSettings
        ? 'api'
        : activeTab;

    const handleTabChange = useCallback((tab: TeamTab) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', tab);
        const query = params.toString();

        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router, searchParams]);

    const renameTeam = async () => {
        if (!currentTeam || !renameValue.trim()) {
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${currentTeam.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ name: renameValue }),
            });

            const data = await response.json().catch(() => ({ error: t('team.page.error.rename') }));
            if (!response.ok) {
                setError(data.error || t('team.page.error.rename'));
                return;
            }

            dispatchTeamsChanged();
            await refreshTeams();
            setError(null);
            await loadTeamDetails(currentTeam.id);
        } catch {
            setError(t('team.page.error.rename'));
        }
    };

    const openTransferDialog = () => {
        const normalizedEmail = transferEmail.trim().toLowerCase();

        if (!normalizedEmail) {
            setTransferEmailError(t('team.page.transfer.error.emailRequired'));
            return;
        }
        if (!EMAIL_PATTERN.test(normalizedEmail)) {
            setTransferEmailError(t('team.page.transfer.error.emailInvalid'));
            return;
        }

        const candidate = eligibleTransferCandidates.find((member) => {
            const memberEmail = member.email?.trim().toLowerCase() ?? '';
            return memberEmail === normalizedEmail;
        });

        if (!candidate) {
            setTransferEmailError(t('team.page.transfer.error.notFound'));
            return;
        }

        setTransferTarget(candidate);
        setIsTransferOpen(true);
        setTransferEmailError(null);
    };

    const transferOwnership = async () => {
        if (!currentTeam || !transferTarget?.email) {
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${currentTeam.id}/ownership`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ email: transferTarget.email }),
            });

            const data = await response.json().catch(() => ({ error: t('team.page.error.transfer') }));
            if (!response.ok) {
                setTransferEmailError(data.error || t('team.page.error.transfer'));
                return;
            }

            await refreshTeams();
            setIsTransferOpen(false);
            setTransferEmail('');
            setTransferEmailError(null);
            setTransferTarget(null);
            setError(null);
            await loadTeamDetails(currentTeam.id);
        } catch {
            setTransferEmailError(t('team.page.error.transfer'));
        }
    };

    const deleteTeam = async () => {
        if (!currentTeam || deleteConfirmationValue !== currentTeam.name) {
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${currentTeam.id}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });

            const data = await response.json().catch(() => ({ error: t('team.page.error.delete') }));
            if (!response.ok) {
                setError(data.error || t('team.page.error.delete'));
                return;
            }

            const nextTeamId = teams.find((team) => team.id !== currentTeam.id)?.id ?? null;
            dispatchTeamsChanged();
            setIsDeleteOpen(false);
            setDeleteConfirmationValue('');
            await refreshTeams();
            if (nextTeamId) {
                await setCurrentTeam(nextTeamId);
                router.push('/projects');
            } else {
                router.push('/welcome');
            }
            setError(null);
        } catch {
            setError(t('team.page.error.delete'));
        }
    };

    const handleMembersChanged = useCallback(async () => {
        if (!currentTeam) {
            return;
        }

        dispatchTeamsChanged();
        await refreshTeams();
        await loadTeamDetails(currentTeam.id);
    }, [currentTeam, loadTeamDetails, refreshTeams]);

    if (isAuthLoading || areTeamsLoading || isCurrentTeamLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-gray-50">
            <Modal
                isOpen={isDeleteOpen}
                onClose={() => {
                    setIsDeleteOpen(false);
                    setDeleteConfirmationValue('');
                }}
                title={t('team.page.delete.title')}
                onConfirm={deleteTeam}
                confirmText={t('team.page.delete.confirm')}
                confirmVariant="danger"
                confirmDisabled={deleteConfirmationValue !== (currentTeam?.name ?? '')}
                closeOnConfirm={false}
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-700">
                        {t('team.page.delete.body', { name: currentTeam?.name ?? '' })}
                    </p>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">
                            {t('team.page.delete.confirmNameLabel', { name: currentTeam?.name ?? '' })}
                        </span>
                        <input
                            type="text"
                            value={deleteConfirmationValue}
                            onChange={(event) => setDeleteConfirmationValue(event.target.value)}
                            placeholder={currentTeam?.name ?? ''}
                            className="w-full rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                            autoFocus
                        />
                    </label>
                </div>
            </Modal>
            <Modal
                isOpen={isTransferOpen}
                onClose={() => {
                    setIsTransferOpen(false);
                    setTransferTarget(null);
                }}
                title={t('team.page.transfer.dialog.title')}
                onConfirm={transferOwnership}
                confirmText={t('team.page.transfer.confirm')}
                confirmVariant="danger"
                closeOnConfirm={false}
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-700">
                        {t('team.page.transfer.dialog.body')}
                    </p>
                    <p className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700">
                        {t('team.page.transfer.dialog.target', { email: transferTarget?.email ?? '' })}
                    </p>
                </div>
            </Modal>

            <div className="max-w-7xl mx-auto px-8 py-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-4">{t('team.page.title')}</h1>

                {error && (
                    <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {currentTeam && teamDetails?.id === currentTeam.id && (
                    <>
                        <div className="border-b border-gray-200 mb-6">
                            <nav className="flex gap-6 -mb-px">
                                <button
                                    type="button"
                                    onClick={() => handleTabChange('api')}
                                    className={`pb-3 text-sm font-medium border-b-2 transition-colors ${visibleTab === 'api'
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                                >
                                    {t('team.page.tab.api')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTabChange('members')}
                                    className={`pb-3 text-sm font-medium border-b-2 transition-colors ${visibleTab === 'members'
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                                >
                                    {t('team.page.tab.members')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTabChange('runners')}
                                    className={`pb-3 text-sm font-medium border-b-2 transition-colors ${visibleTab === 'runners'
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                                >
                                    {t('team.page.tab.runners')}
                                </button>
                                {canAccessSettings && (
                                    <button
                                        type="button"
                                        onClick={() => handleTabChange('settings')}
                                        className={`pb-3 text-sm font-medium border-b-2 transition-colors ${visibleTab === 'settings'
                                            ? 'border-primary text-primary'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                        }`}
                                    >
                                        {t('team.page.tab.settings')}
                                    </button>
                                )}
                            </nav>
                        </div>

                        {visibleTab === 'api' && (
                            <div className="space-y-6">
                                <TeamAiSettings teamId={currentTeam.id} />
                                <TeamUsage teamId={currentTeam.id} />
                            </div>
                        )}

                        {visibleTab === 'members' && (
                            <TeamMembers
                                teamId={currentTeam.id}
                                onMembersChanged={handleMembersChanged}
                            />
                        )}

                        {visibleTab === 'runners' && (
                            <TeamRunners teamId={currentTeam.id} />
                        )}

                        {visibleTab === 'settings' && canAccessSettings && (
                            <div className="space-y-6">
                                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                    <h2 className="text-base font-semibold text-gray-900">{t('team.page.settings.name')}</h2>
                                    <div className="mt-4 flex flex-wrap items-center gap-3">
                                        <input
                                            type="text"
                                            value={renameValue}
                                            onChange={(event) => setRenameValue(event.target.value)}
                                            disabled={!teamDetails.canRename || !isEditingSettings}
                                            className="h-10 w-full max-w-sm rounded-md border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50"
                                        />
                                        {teamDetails.canRename && (
                                            isEditingSettings ? (
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => void renameTeam()}
                                                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                                                    >
                                                        {t('team.page.settings.save')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setRenameValue(teamDetails.name);
                                                            setIsEditingSettings(false);
                                                        }}
                                                        className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                                    >
                                                        {t('common.cancel')}
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsEditingSettings(true)}
                                                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                                >
                                                    {t('team.page.settings.edit')}
                                                </button>
                                            )
                                        )}
                                    </div>
                                </section>

                                {teamDetails.canTransferOwnership && (
                                    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                        <h2 className="text-base font-semibold text-gray-900">{t('team.page.transfer.title')}</h2>
                                        <p className="mt-1 text-sm text-gray-500">{t('team.page.transfer.subtitle')}</p>
                                        <div className="mt-4 max-w-sm space-y-2">
                                            <label className="block text-sm font-medium text-gray-700">
                                                {t('team.page.transfer.emailLabel')}
                                            </label>
                                            <input
                                                type="email"
                                                value={transferEmail}
                                                onChange={(event) => {
                                                    setTransferEmail(event.target.value);
                                                    setTransferEmailError(null);
                                                }}
                                                placeholder={t('team.page.transfer.emailPlaceholder')}
                                                className="h-10 w-full rounded-md border border-gray-300 px-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                                            />
                                            {transferEmailError && (
                                                <p className="text-sm text-red-600">{transferEmailError}</p>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={openTransferDialog}
                                            disabled={eligibleTransferCandidates.length === 0}
                                            className="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                        >
                                            {t('team.page.transfer.confirm')}
                                        </button>
                                        {eligibleTransferCandidates.length === 0 && (
                                            <p className="mt-2 text-sm text-gray-500">{t('team.page.transfer.noEligibleMembers')}</p>
                                        )}
                                    </section>
                                )}

                                {teamDetails.canDelete && (
                                    <section className="rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm">
                                        <h2 className="text-base font-semibold text-red-700">{t('team.page.delete.zoneTitle')}</h2>
                                        <p className="mt-1 text-sm text-red-600">{t('team.page.delete.zoneSubtitle')}</p>
                                        <button
                                            type="button"
                                            onClick={() => setIsDeleteOpen(true)}
                                            className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                                        >
                                            {t('team.page.delete.open')}
                                        </button>
                                    </section>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}

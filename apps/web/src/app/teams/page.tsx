'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import {
    Button,
    LastUpdatedBadge,
    Modal,
    PageHeaderSkeleton,
    SectionLoadingState,
    UnderlineTabs,
} from '@/components/shared';
import TeamAiSettings from '@/components/features/team-ai/ui/TeamAiSettings';
import TeamMembers from '@/components/features/team-members/ui/TeamMembers';
import TeamUsage from '@/components/features/team-usage/ui/TeamUsage';
import { TeamRunners } from '@/components/features/team-runners';
import { useTeamsBootstrap, type TeamMemberBootstrap } from '@/hooks/team/useTeamsBootstrap';
import { dispatchTeamsChanged } from '@/hooks/team/useTeams';
import { useI18n } from '@/i18n';
import { runOnEnterKey } from '@/utils/keyboard/enterKey';
import { useLoadGuard } from '@/hooks/ui/useLoadGuard';
type TeamMemberOption = TeamMemberBootstrap;

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
    const requestedTeamId = searchParams.get('teamId')?.trim() || '';
    const {
        teams,
        currentTeam: selectedTeam,
        teamDetails,
        members,
        loading: isTeamsBootstrapLoading,
        isInitialLoading: isTeamsInitialLoading,
        isRefreshing: isTeamsRefreshing,
        lastUpdatedAt,
        error: bootstrapError,
        refresh: refreshTeamsBootstrap,
        setCurrentTeam,
    } = useTeamsBootstrap(getAccessToken, requestedTeamId, isLoggedIn && !isAuthLoading);
    const [renameValue, setRenameValue] = useState('');
    const [transferEmail, setTransferEmail] = useState('');
    const [transferTarget, setTransferTarget] = useState<TeamMemberOption | null>(null);
    const [transferEmailError, setTransferEmailError] = useState<string | null>(null);
    const [isEditingSettings, setIsEditingSettings] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [isTransferOpen, setIsTransferOpen] = useState(false);
    const [isDeletingTeamTransition, setIsDeletingTeamTransition] = useState(false);
    const [deleteConfirmationValue, setDeleteConfirmationValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const { isSlow, isStalled } = useLoadGuard(isTeamsInitialLoading || isTeamsRefreshing || isDeletingTeamTransition);

    const currentTeam = useMemo(() => {
        if (!selectedTeam) {
            return null;
        }

        return teams.find((team) => team.id === selectedTeam.id) ?? null;
    }, [selectedTeam, teams]);

    const eligibleTransferCandidates = useMemo(
        () => members.filter((member) => member.role !== 'OWNER' && member.userId && member.email),
        [members]
    );

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push('/');
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        if (isDeletingTeamTransition) {
            return;
        }

        if (!isAuthLoading && isLoggedIn && !isTeamsBootstrapLoading && teams.length === 0) {
            router.push('/welcome');
        }
    }, [isTeamsBootstrapLoading, isAuthLoading, isDeletingTeamTransition, isLoggedIn, teams.length, router]);

    const activeTab = resolveTeamTab(searchParams.get('tab'));
    const visibleError = error || (bootstrapError ? t('team.page.error.load') : null);

    const canAccessSettings = teamDetails !== null && (
        teamDetails.canRename ||
        teamDetails.canDelete ||
        teamDetails.canTransferOwnership
    );
    const visibleTab = activeTab === 'settings' && !canAccessSettings
        ? 'api'
        : activeTab;
    const tabItems = [
        { id: 'api' as const, label: t('team.page.tab.api') },
        { id: 'members' as const, label: t('team.page.tab.members') },
        { id: 'runners' as const, label: t('team.page.tab.runners') },
        { id: 'settings' as const, label: t('team.page.tab.settings'), hidden: !canAccessSettings },
    ];

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

            setIsEditingSettings(false);
            dispatchTeamsChanged();
            await refreshTeamsBootstrap();
            setError(null);
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

            await refreshTeamsBootstrap();
            setIsTransferOpen(false);
            setTransferEmail('');
            setTransferEmailError(null);
            setTransferTarget(null);
            setError(null);
        } catch {
            setTransferEmailError(t('team.page.error.transfer'));
        }
    };

    const deleteTeam = async () => {
        if (!currentTeam || deleteConfirmationValue !== currentTeam.name) {
            return;
        }

        setIsDeletingTeamTransition(true);
        setError(null);
        setIsDeleteOpen(false);
        setDeleteConfirmationValue('');

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${currentTeam.id}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });

            const data = await response.json().catch(() => ({ error: t('team.page.error.delete') }));
            if (!response.ok) {
                setError(data.error || t('team.page.error.delete'));
                setIsDeletingTeamTransition(false);
                return;
            }

            const nextTeamId = teams.find((team) => team.id !== currentTeam.id)?.id ?? null;
            dispatchTeamsChanged();
            await refreshTeamsBootstrap();
            if (nextTeamId) {
                await setCurrentTeam(nextTeamId);
                router.push('/projects');
            } else {
                router.push('/welcome');
            }
        } catch {
            setError(t('team.page.error.delete'));
            setIsDeletingTeamTransition(false);
        }
    };

    const handleMembersChanged = useCallback(async () => {
        if (!currentTeam) {
            return;
        }

        dispatchTeamsChanged();
        await refreshTeamsBootstrap();
    }, [currentTeam, refreshTeamsBootstrap]);

    if (isAuthLoading || (isTeamsInitialLoading && !currentTeam && teams.length === 0)) {
        return (
            <main className="min-h-screen bg-gray-50">
                <div className="max-w-7xl mx-auto px-8 py-8">
                    <PageHeaderSkeleton withAction={false} />
                    <div className="mb-6 flex gap-3">
                        <div className="skeleton-block h-9 w-20 rounded-full" />
                        <div className="skeleton-block h-9 w-24 rounded-full" />
                        <div className="skeleton-block h-9 w-24 rounded-full" />
                        <div className="skeleton-block h-9 w-24 rounded-full" />
                    </div>
                    <div className="space-y-6">
                        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                            <div className="skeleton-block h-5 w-40" />
                            <div className="mt-4 space-y-3">
                                <div className="skeleton-block h-4 w-full" />
                                <div className="skeleton-block h-4 w-10/12" />
                                <div className="skeleton-block h-4 w-8/12" />
                            </div>
                        </section>
                        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                            <div className="skeleton-block h-5 w-36" />
                            <div className="mt-4 space-y-3">
                                <div className="skeleton-block h-4 w-full" />
                                <div className="skeleton-block h-4 w-9/12" />
                                <div className="skeleton-block h-4 w-11/12" />
                            </div>
                        </section>
                    </div>
                </div>
            </main>
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
                <div className="mb-4 flex items-center justify-between">
                    <h1 className="text-3xl font-bold text-gray-900">{t('team.page.title')}</h1>
                    <LastUpdatedBadge lastUpdatedAt={lastUpdatedAt} />
                </div>

                <SectionLoadingState
                    state={visibleError ? 'error' : ((isTeamsRefreshing || isDeletingTeamTransition) ? 'refreshing' : 'idle')}
                    errorMessage={visibleError}
                    isSlow={isSlow}
                    isStalled={isStalled}
                    onRetry={() => {
                        void refreshTeamsBootstrap();
                    }}
                >
                    {currentTeam && teamDetails?.id === currentTeam.id && (
                        <>
                            <div className="mb-6">
                                <UnderlineTabs
                                    tabs={tabItems}
                                    activeTab={visibleTab}
                                    onChange={handleTabChange}
                                />
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
                                                value={isEditingSettings ? renameValue : teamDetails.name}
                                                onChange={(event) => setRenameValue(event.target.value)}
                                                onKeyDown={(event) => {
                                                    runOnEnterKey(event, () => {
                                                        void renameTeam();
                                                    }, {
                                                        enabled: isEditingSettings && teamDetails.canRename,
                                                    });
                                                }}
                                                disabled={!teamDetails.canRename || !isEditingSettings}
                                                className="h-10 w-full max-w-sm rounded-md border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50"
                                            />
                                            {teamDetails.canRename && (
                                                isEditingSettings ? (
                                                    <div className="flex gap-2">
                                                        <Button
                                                            onClick={() => void renameTeam()}
                                                            variant="primary"
                                                            size="sm"
                                                        >
                                                            {t('team.page.settings.save')}
                                                        </Button>
                                                        <Button
                                                            onClick={() => {
                                                                setRenameValue(teamDetails.name);
                                                                setIsEditingSettings(false);
                                                            }}
                                                            variant="secondary"
                                                            size="sm"
                                                        >
                                                            {t('common.cancel')}
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        onClick={() => {
                                                            setRenameValue(teamDetails.name);
                                                            setIsEditingSettings(true);
                                                        }}
                                                        variant="secondary"
                                                        size="sm"
                                                    >
                                                        {t('team.page.settings.edit')}
                                                    </Button>
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
                                            <Button
                                                onClick={openTransferDialog}
                                                disabled={eligibleTransferCandidates.length === 0}
                                                variant="danger"
                                                size="sm"
                                                className="mt-3"
                                            >
                                                {t('team.page.transfer.confirm')}
                                            </Button>
                                            {eligibleTransferCandidates.length === 0 && (
                                                <p className="mt-2 text-sm text-gray-500">{t('team.page.transfer.noEligibleMembers')}</p>
                                            )}
                                        </section>
                                    )}

                                    {teamDetails.canDelete && (
                                        <section className="rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm">
                                            <h2 className="text-base font-semibold text-red-700">{t('team.page.delete.zoneTitle')}</h2>
                                            <p className="mt-1 text-sm text-red-600">{t('team.page.delete.zoneSubtitle')}</p>
                                            <Button
                                                onClick={() => setIsDeleteOpen(true)}
                                                variant="danger"
                                                size="sm"
                                                className="mt-4"
                                            >
                                                {t('team.page.delete.open')}
                                            </Button>
                                        </section>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </SectionLoadingState>
            </div>
        </main>
    );
}

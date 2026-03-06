'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { CustomSelect, Modal } from '@/components/shared';
import TeamAiSettings from '@/components/features/team-ai/ui/TeamAiSettings';
import TeamMembers from '@/components/features/team-members/ui/TeamMembers';
import TeamUsage from '@/components/features/team-usage/ui/TeamUsage';
import { useCurrentTeam } from '@/hooks/useCurrentTeam';
import { dispatchTeamsChanged, useTeams } from '@/hooks/useTeams';
import { useI18n } from '@/i18n';

interface TeamDetails {
    id: string;
    name: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    canRename: boolean;
    canDelete: boolean;
    canTransferOwnership: boolean;
}

interface TeamMemberOption {
    id: string;
    userId: string | null;
    email: string | null;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export default function TeamsPage() {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const { t } = useI18n();
    const { teams, loading: areTeamsLoading, refresh: refreshTeams } = useTeams(getAccessToken, isLoggedIn);
    const {
        currentTeam: selectedTeam,
        loading: isCurrentTeamLoading,
        setCurrentTeam,
    } = useCurrentTeam(getAccessToken, isLoggedIn);
    const [teamDetails, setTeamDetails] = useState<TeamDetails | null>(null);
    const [ownerCandidates, setOwnerCandidates] = useState<TeamMemberOption[]>([]);
    const [renameValue, setRenameValue] = useState('');
    const [transferUserId, setTransferUserId] = useState('');
    const [activeTab, setActiveTab] = useState<'api' | 'members' | 'settings'>('api');
    const [isEditingSettings, setIsEditingSettings] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [deleteConfirmationValue, setDeleteConfirmationValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const currentTeam = useMemo(() => {
        if (!selectedTeam) {
            return null;
        }

        return teams.find((team) => team.id === selectedTeam.id) ?? null;
    }, [selectedTeam, teams]);

    const ownerOptions = ownerCandidates
        .filter((member) => member.role !== 'OWNER' && member.userId)
        .map((member) => ({
            value: member.userId as string,
            label: member.email || t('team.members.unknownEmail'),
        }));

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
        setOwnerCandidates(membersData.members);
        setTransferUserId(
            membersData.members.find((member) => member.role !== 'OWNER' && member.userId)?.userId ?? ''
        );
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

    const visibleTab = activeTab === 'settings' && currentTeam?.role !== 'OWNER'
        ? 'api'
        : activeTab;

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
            setSuccess(t('team.page.success.rename'));
            setError(null);
            await loadTeamDetails(currentTeam.id);
        } catch {
            setError(t('team.page.error.rename'));
        }
    };

    const transferOwnership = async () => {
        if (!currentTeam || !transferUserId) {
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
                body: JSON.stringify({ userId: transferUserId }),
            });

            const data = await response.json().catch(() => ({ error: t('team.page.error.transfer') }));
            if (!response.ok) {
                setError(data.error || t('team.page.error.transfer'));
                return;
            }

            await refreshTeams();
            setSuccess(t('team.page.success.transfer'));
            setError(null);
            await loadTeamDetails(currentTeam.id);
        } catch {
            setError(t('team.page.error.transfer'));
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
            setSuccess(t('team.page.success.delete'));
            setError(null);
        } catch {
            setError(t('team.page.error.delete'));
        }
    };

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

            <div className="max-w-7xl mx-auto px-8 py-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-4">{t('team.page.title')}</h1>

                {error && (
                    <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {success}
                    </div>
                )}

                {currentTeam && teamDetails?.id === currentTeam.id && (
                    <>
                        <div className="border-b border-gray-200 mb-6">
                            <nav className="flex gap-6 -mb-px">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('api')}
                                    className={`pb-3 text-sm font-medium border-b-2 transition-colors ${visibleTab === 'api'
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                                >
                                    {t('team.page.tab.api')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('members')}
                                    className={`pb-3 text-sm font-medium border-b-2 transition-colors ${visibleTab === 'members'
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                                >
                                    {t('team.page.tab.members')}
                                </button>
                                {currentTeam.role === 'OWNER' && (
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab('settings')}
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
                            <TeamMembers teamId={currentTeam.id} teamRole={currentTeam.role} />
                        )}

                        {visibleTab === 'settings' && currentTeam.role === 'OWNER' && (
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

                                {teamDetails.canTransferOwnership && ownerOptions.length > 0 && (
                                    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                        <h2 className="text-base font-semibold text-gray-900">{t('team.page.transfer.title')}</h2>
                                        <p className="mt-1 text-sm text-gray-500">{t('team.page.transfer.subtitle')}</p>
                                        <div className="mt-4 max-w-sm">
                                            <CustomSelect
                                                value={transferUserId}
                                                options={ownerOptions}
                                                onChange={setTransferUserId}
                                                ariaLabel={t('team.page.transfer.title')}
                                                fullWidth
                                                buttonClassName="shadow-none"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void transferOwnership()}
                                            disabled={!transferUserId}
                                            className="mt-3 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            {t('team.page.transfer.confirm')}
                                        </button>
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

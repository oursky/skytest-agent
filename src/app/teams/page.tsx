'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { CustomSelect, Modal } from '@/components/shared';
import TeamAiSettings from '@/components/features/team-ai/ui/TeamAiSettings';
import TeamMembers from '@/components/features/team-members/ui/TeamMembers';
import TeamUsage from '@/components/features/team-usage/ui/TeamUsage';
import { useCurrentTeam } from '@/hooks/useCurrentTeam';
import { useTeams } from '@/hooks/useTeams';
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
    userId: string;
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
    const [newTeamName, setNewTeamName] = useState('');
    const [renameValue, setRenameValue] = useState('');
    const [transferUserId, setTransferUserId] = useState('');
    const [activeTab, setActiveTab] = useState<'api' | 'members' | 'settings'>('api');
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isCreateSubmitting, setIsCreateSubmitting] = useState(false);
    const [isEditingSettings, setIsEditingSettings] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const currentTeam = useMemo(() => {
        if (!selectedTeam) {
            return null;
        }

        return teams.find((team) => team.id === selectedTeam.id) ?? null;
    }, [selectedTeam, teams]);

    const ownerOptions = ownerCandidates
        .filter((member) => member.role !== 'OWNER')
        .map((member) => ({
            value: member.userId,
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
        setTransferUserId(membersData.members.find((member) => member.role !== 'OWNER')?.userId ?? '');
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

    useEffect(() => {
        if (activeTab === 'settings' && currentTeam?.role !== 'OWNER') {
            setActiveTab('api');
        }
    }, [activeTab, currentTeam]);

    const createTeam = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!newTeamName.trim()) {
            return;
        }

        try {
            setIsCreateSubmitting(true);
            const token = await getAccessToken();
            const response = await fetch('/api/teams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ name: newTeamName }),
            });

            const data = await response.json().catch(() => ({ error: t('team.page.error.create') }));
            if (!response.ok || typeof data.id !== 'string') {
                setError(data.error || t('team.page.error.create'));
                return;
            }

            await refreshTeams();
            await setCurrentTeam(data.id);
            setNewTeamName('');
            setIsCreateModalOpen(false);
            setSuccess(t('team.page.success.create'));
            setError(null);
        } catch {
            setError(t('team.page.error.create'));
        } finally {
            setIsCreateSubmitting(false);
        }
    };

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
        if (!currentTeam) {
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

            setIsDeleteOpen(false);
            await refreshTeams();
            const nextTeamId = teams.find((team) => team.id !== currentTeam.id)?.id;
            if (nextTeamId) {
                await setCurrentTeam(nextTeamId);
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
        <main className="min-h-screen bg-gray-50 px-6 py-8 md:px-8">
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title={t('team.page.create.open')}
                closeOnConfirm={false}
                panelClassName="max-w-lg"
            >
                <form onSubmit={createTeam} className="space-y-4">
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
                    <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                        <button
                            type="button"
                            onClick={() => setIsCreateModalOpen(false)}
                            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={isCreateSubmitting || !newTeamName.trim()}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                        >
                            {t('team.page.create.confirm')}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal
                isOpen={isDeleteOpen}
                onClose={() => setIsDeleteOpen(false)}
                title={t('team.page.delete.title')}
                onConfirm={deleteTeam}
                confirmText={t('team.page.delete.confirm')}
                confirmVariant="danger"
            >
                <p className="text-sm text-gray-700">
                    {t('team.page.delete.body', { name: currentTeam?.name ?? '' })}
                </p>
            </Modal>

            <div className="mx-auto max-w-7xl space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold text-gray-900">{t('team.page.title')}</h1>
                    <button
                        type="button"
                        onClick={() => setIsCreateModalOpen(true)}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                    >
                        {t('team.page.create.open')}
                    </button>
                </div>

                {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {success}
                    </div>
                )}

                {currentTeam && (
                    <>
                        {teamDetails?.id === currentTeam.id && (
                            <>
                                <div className="border-b border-gray-200">
                                    <nav className="-mb-px flex gap-6">
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab('api')}
                                            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'api'
                                                ? 'border-primary text-primary'
                                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                            }`}
                                        >
                                            {t('team.page.tab.api')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab('members')}
                                            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'members'
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
                                                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'settings'
                                                    ? 'border-primary text-primary'
                                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                                }`}
                                            >
                                                {t('team.page.tab.settings')}
                                            </button>
                                        )}
                                    </nav>
                                </div>

                                {activeTab === 'api' && (
                                    <div className="space-y-6">
                                        <TeamAiSettings teamId={currentTeam.id} />
                                        <TeamUsage teamId={currentTeam.id} />
                                    </div>
                                )}

                                {activeTab === 'members' && (
                                    <TeamMembers teamId={currentTeam.id} teamRole={currentTeam.role} />
                                )}

                                {activeTab === 'settings' && currentTeam.role === 'OWNER' && (
                                    <div className="space-y-6">
                                        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                                            <div className="grid gap-6 lg:grid-cols-[minmax(0,440px),1fr]">
                                                <div className="space-y-3">
                                                    <label className="block space-y-2">
                                                        <span className="text-sm font-medium text-gray-700">{t('team.page.settings.name')}</span>
                                                        <div className="flex max-w-md items-center gap-3">
                                                            <input
                                                                type="text"
                                                                value={renameValue}
                                                                onChange={(event) => setRenameValue(event.target.value)}
                                                                disabled={!teamDetails.canRename || !isEditingSettings}
                                                                className="h-10 w-full rounded-md border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50"
                                                            />
                                                            {teamDetails.canRename && (
                                                                isEditingSettings ? (
                                                                    <>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => void renameTeam()}
                                                                            className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                                                        >
                                                                            {t('team.page.settings.save')}
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setRenameValue(teamDetails.name);
                                                                                setIsEditingSettings(false);
                                                                            }}
                                                                            className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                                                        >
                                                                            {t('common.cancel')}
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setIsEditingSettings(true)}
                                                                        className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                                                    >
                                                                        {t('team.page.settings.edit')}
                                                                    </button>
                                                                )
                                                            )}
                                                        </div>
                                                    </label>
                                                </div>

                                                {teamDetails.canTransferOwnership && ownerOptions.length > 0 && (
                                                    <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
                                                        <div>
                                                            <h2 className="text-sm font-semibold text-gray-900">{t('team.page.transfer.title')}</h2>
                                                            <p className="text-sm text-gray-500">{t('team.page.transfer.subtitle')}</p>
                                                        </div>
                                                        <CustomSelect
                                                            value={transferUserId}
                                                            options={ownerOptions}
                                                            onChange={setTransferUserId}
                                                            ariaLabel={t('team.page.transfer.title')}
                                                            fullWidth
                                                            buttonClassName="shadow-none"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => void transferOwnership()}
                                                            disabled={!transferUserId}
                                                            className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white disabled:opacity-50"
                                                        >
                                                            {t('team.page.transfer.confirm')}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </section>

                                        {teamDetails.canDelete && (
                                            <section className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
                                                <div className="space-y-3">
                                                    <div>
                                                        <h2 className="text-sm font-semibold text-red-700">{t('team.page.delete.zoneTitle')}</h2>
                                                        <p className="text-sm text-red-600">{t('team.page.delete.zoneSubtitle')}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsDeleteOpen(true)}
                                                        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                                                    >
                                                        {t('team.page.delete.open')}
                                                    </button>
                                                </div>
                                            </section>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}

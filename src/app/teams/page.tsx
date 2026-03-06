'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { CustomSelect, Modal } from '@/components/shared';
import TeamAiSettings from '@/components/features/team-ai/ui/TeamAiSettings';
import TeamMembers from '@/components/features/team-members/ui/TeamMembers';
import TeamUsage from '@/components/features/team-usage/ui/TeamUsage';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { useOrganizations } from '@/hooks/useOrganizations';
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
    const { organizations, loading: areTeamsLoading, refresh: refreshTeams } = useOrganizations(getAccessToken, isLoggedIn);
    const { currentOrganization, loading: isCurrentTeamLoading, setCurrentOrganization } = useCurrentOrganization(getAccessToken, isLoggedIn);
    const [teamDetails, setTeamDetails] = useState<TeamDetails | null>(null);
    const [ownerCandidates, setOwnerCandidates] = useState<TeamMemberOption[]>([]);
    const [newTeamName, setNewTeamName] = useState('');
    const [renameValue, setRenameValue] = useState('');
    const [transferUserId, setTransferUserId] = useState('');
    const [activeTab, setActiveTab] = useState<'members' | 'api'>('members');
    const [isCreating, setIsCreating] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const currentTeam = useMemo(() => {
        if (!currentOrganization) {
            return null;
        }

        return organizations.find((organization) => organization.id === currentOrganization.id) ?? null;
    }, [currentOrganization, organizations]);

    const ownerOptions = ownerCandidates
        .filter((member) => member.role !== 'OWNER')
        .map((member) => ({
            value: member.userId,
            label: member.email || t('team.members.unknownEmail'),
        }));

    const loadTeamDetails = useCallback(async (organizationId: string) => {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

        const [detailsResponse, membersResponse] = await Promise.all([
            fetch(`/api/teams/${organizationId}`, { headers }),
            fetch(`/api/teams/${organizationId}/members`, { headers }),
        ]);

        if (!detailsResponse.ok || !membersResponse.ok) {
            throw new Error('Failed to load team details');
        }

        const details = await detailsResponse.json() as TeamDetails;
        const membersData = await membersResponse.json() as { members: TeamMemberOption[] };
        setTeamDetails(details);
        setRenameValue(details.name);
        setOwnerCandidates(membersData.members);
        setTransferUserId(membersData.members.find((member) => member.role !== 'OWNER')?.userId ?? '');
    }, [getAccessToken]);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push('/');
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        if (!isAuthLoading && isLoggedIn && !areTeamsLoading && organizations.length === 0) {
            router.push('/welcome');
        }
    }, [areTeamsLoading, isAuthLoading, isLoggedIn, organizations.length, router]);

    useEffect(() => {
        if (!currentOrganization || organizations.length === 0) {
            return;
        }

        queueMicrotask(() => {
            void loadTeamDetails(currentOrganization.id).catch(() => {
                setError(t('team.page.error.load'));
            });
        });
    }, [currentOrganization, organizations.length, loadTeamDetails, t]);

    const createTeam = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!newTeamName.trim()) {
            return;
        }

        try {
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
            await setCurrentOrganization(data.id);
            setNewTeamName('');
            setIsCreating(false);
            setSuccess(t('team.page.success.create'));
            setError(null);
        } catch {
            setError(t('team.page.error.create'));
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
            const nextTeamId = organizations.find((team) => team.id !== currentTeam.id)?.id;
            if (nextTeamId) {
                await setCurrentOrganization(nextTeamId);
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
        <main className="min-h-screen bg-gray-50 px-8 py-8">
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
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">{t('team.page.title')}</h1>
                        <p className="mt-1 text-sm text-gray-500">{t('team.page.subtitle')}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsCreating((open) => !open)}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                    >
                        {t('team.page.create.open')}
                    </button>
                </div>

                {isCreating && (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                        <form onSubmit={createTeam} className="flex gap-4">
                            <input
                                type="text"
                                value={newTeamName}
                                onChange={(event) => setNewTeamName(event.target.value)}
                                placeholder={t('team.page.create.placeholder')}
                                className="flex-1 rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                            <button
                                type="submit"
                                disabled={!newTeamName.trim()}
                                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                            >
                                {t('team.page.create.confirm')}
                            </button>
                        </form>
                    </div>
                )}

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {organizations.map((organization) => {
                        const isActive = currentTeam?.id === organization.id;

                        return (
                            <button
                                key={organization.id}
                                type="button"
                                onClick={() => void setCurrentOrganization(organization.id)}
                                className={`rounded-xl border p-5 text-left shadow-sm transition-colors ${isActive ? 'border-primary bg-white ring-2 ring-primary/20' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                            >
                                <div className="text-sm font-medium text-primary">{t(`team.members.roles.${organization.role.toLowerCase()}`)}</div>
                                <div className="mt-2 text-lg font-semibold text-gray-900">{organization.name}</div>
                            </button>
                        );
                    })}
                </div>

                {currentTeam && teamDetails?.id === currentTeam.id && (
                    <>
                        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900">{t('team.page.settings.title')}</h2>
                                    <p className="text-sm text-gray-500">{t('team.page.settings.subtitle')}</p>
                                </div>
                                {teamDetails.canDelete && (
                                    <button
                                        type="button"
                                        onClick={() => setIsDeleteOpen(true)}
                                        className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                                    >
                                        {t('team.page.delete.open')}
                                    </button>
                                )}
                            </div>

                            <div className="grid gap-4 lg:grid-cols-[1.5fr,1fr]">
                                <div className="space-y-3">
                                    <label className="block space-y-2">
                                        <span className="text-sm font-medium text-gray-700">{t('team.page.settings.name')}</span>
                                        <input
                                            type="text"
                                            value={renameValue}
                                            onChange={(event) => setRenameValue(event.target.value)}
                                            disabled={!teamDetails.canRename}
                                            className="w-full rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50"
                                        />
                                    </label>
                                    {teamDetails.canRename && (
                                        <button
                                            type="button"
                                            onClick={() => void renameTeam()}
                                            className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                        >
                                            {t('team.page.settings.save')}
                                        </button>
                                    )}
                                </div>

                                {teamDetails.canTransferOwnership && ownerOptions.length > 0 && (
                                    <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
                                        <div>
                                            <h3 className="text-sm font-semibold text-gray-900">{t('team.page.transfer.title')}</h3>
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
                        </div>

                        <div className="border-b border-gray-200">
                            <nav className="-mb-px flex gap-6">
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
                            </nav>
                        </div>

                        {activeTab === 'members' && (
                            <TeamMembers organizationId={currentTeam.id} organizationRole={currentTeam.role} />
                        )}

                        {activeTab === 'api' && (
                            <div className="space-y-6">
                                <TeamAiSettings organizationId={currentTeam.id} />
                                <TeamUsage organizationId={currentTeam.id} />
                            </div>
                        )}
                    </>
                )}

                {success && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {success}
                    </div>
                )}
                {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}
            </div>
        </main>
    );
}

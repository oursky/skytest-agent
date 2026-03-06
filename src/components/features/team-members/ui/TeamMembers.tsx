'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { CustomSelect, Modal } from '@/components/shared';
import { useI18n } from '@/i18n';
import { formatDateTimeCompact } from '@/utils/dateFormatter';

interface TeamMembersProps {
    teamId: string;
    teamRole: 'OWNER' | 'ADMIN' | 'MEMBER';
    onMembersChanged?: () => Promise<void> | void;
}

interface Member {
    id: string;
    userId: string | null;
    email: string | null;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    createdAt: string;
}

export default function TeamMembers({ teamId, teamRole, onMembersChanged }: TeamMembersProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [members, setMembers] = useState<Member[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [memberEmail, setMemberEmail] = useState('');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);

    const canManage = teamRole === 'OWNER' || teamRole === 'ADMIN';

    const roleOptions = useMemo(() => {
        if (teamRole === 'OWNER') {
            return [
                { value: 'OWNER' as const, label: t('team.members.roles.owner') },
                { value: 'ADMIN' as const, label: t('team.members.roles.admin') },
                { value: 'MEMBER' as const, label: t('team.members.roles.member') },
            ];
        }

        if (teamRole === 'ADMIN') {
            return [
                { value: 'ADMIN' as const, label: t('team.members.roles.admin') },
                { value: 'MEMBER' as const, label: t('team.members.roles.member') },
            ];
        }

        return [];
    }, [t, teamRole]);

    const loadData = useCallback(async () => {
        try {
            setIsLoading(true);
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
            const response = await fetch(`/api/teams/${teamId}/members`, { headers });

            if (!response.ok) {
                throw new Error('Failed to load team members');
            }

            const data = await response.json() as { members: Member[] };
            setMembers(data.members);
            setError(null);
        } catch {
            setError(t('team.members.error.load'));
        } finally {
            setIsLoading(false);
        }
    }, [getAccessToken, teamId, t]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const notifyMembersChanged = useCallback(async () => {
        if (!onMembersChanged) {
            return;
        }

        await onMembersChanged();
    }, [onMembersChanged]);

    const updateMemberRole = async (memberId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') => {
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${teamId}/members/${memberId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ role }),
            });

            const data = await response.json().catch(() => ({ error: t('team.members.error.role') }));
            if (!response.ok) {
                setError(data.error || t('team.members.error.role'));
                return;
            }

            await loadData();
            await notifyMembersChanged();
            setSuccess(t('team.members.success.role'));
            setError(null);
        } catch {
            setError(t('team.members.error.role'));
        }
    };

    const addMember = async () => {
        if (!memberEmail.trim()) {
            setError(t('team.members.add.error.email'));
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${teamId}/members`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ email: memberEmail }),
            });

            const data = await response.json().catch(() => ({ error: t('team.members.add.error.create') }));
            if (!response.ok) {
                setError(data.error || t('team.members.add.error.create'));
                return;
            }

            setMembers((current) => [data as Member, ...current]);
            setMemberEmail('');
            setIsAddModalOpen(false);
            await notifyMembersChanged();
            setSuccess(t('team.members.add.success'));
            setError(null);
        } catch {
            setError(t('team.members.add.error.create'));
        }
    };

    const removeMember = async () => {
        if (!memberToRemove) {
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${teamId}/members/${memberToRemove.id}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });

            const data = await response.json().catch(() => ({ error: t('team.members.error.remove') }));
            if (!response.ok) {
                setError(data.error || t('team.members.error.remove'));
                return;
            }

            setMembers((current) => current.filter((member) => member.id !== memberToRemove.id));
            setMemberToRemove(null);
            await notifyMembersChanged();
            setSuccess(t('team.members.success.remove'));
            setError(null);
        } catch {
            setError(t('team.members.error.remove'));
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <section className="space-y-6">
            <Modal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                title={t('team.members.add.open')}
                onConfirm={addMember}
                confirmText={t('team.members.add.confirm')}
                closeOnConfirm={false}
                panelClassName="max-w-lg"
            >
                <div className="space-y-4 pb-4">
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('team.members.add.email')}</span>
                        <input
                            type="email"
                            value={memberEmail}
                            onChange={(event) => setMemberEmail(event.target.value)}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder={t('team.members.add.emailPlaceholder')}
                        />
                    </label>
                </div>
            </Modal>

            <Modal
                isOpen={memberToRemove !== null}
                onClose={() => setMemberToRemove(null)}
                title={t('team.members.remove.title')}
                onConfirm={removeMember}
                confirmText={t('team.members.remove.confirm')}
                confirmVariant="danger"
            >
                <p className="text-sm text-gray-700">
                    {t('team.members.remove.body', { email: memberToRemove?.email ?? '' })}
                </p>
            </Modal>

            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-base font-semibold text-gray-900">{t('team.members.title')}</h2>
                    <p className="mt-1 text-sm text-gray-500">{t('team.members.subtitle')}</p>
                </div>
                {canManage && (
                    <button
                        type="button"
                        onClick={() => setIsAddModalOpen(true)}
                        className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                    >
                        {t('team.members.add.open')}
                    </button>
                )}
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                {members.length === 0 ? (
                    <div className="px-6 py-12 text-center text-sm text-gray-500">{t('team.members.empty')}</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100 text-sm">
                            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-4 py-2.5">{t('team.members.table.person')}</th>
                                    <th className="px-4 py-2.5">{t('team.members.table.role')}</th>
                                    <th className="px-4 py-2.5">{t('team.members.table.dateAdded')}</th>
                                    <th className="px-4 py-2.5 text-right">{t('team.members.table.actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 text-gray-700">
                                {members.map((member) => (
                                    <tr key={member.id} className="hover:bg-gray-50/50">
                                        <td className="px-4 py-3 align-middle">
                                            <div className="font-medium text-gray-900">
                                                {member.email || t('team.members.unknownEmail')}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 align-middle">
                                            {member.role !== 'OWNER' && canManage ? (
                                                <CustomSelect
                                                    value={member.role}
                                                    options={roleOptions}
                                                    onChange={(role) => void updateMemberRole(member.id, role)}
                                                    ariaLabel={t('team.members.role')}
                                                    buttonClassName="min-w-32 rounded-full border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 shadow-none hover:bg-gray-100"
                                                    menuClassName="min-w-36"
                                                />
                                            ) : (
                                                <span className="inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                                                    {t(`team.members.roles.${member.role.toLowerCase()}`)}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 align-middle text-sm text-gray-500">
                                            {formatDateTimeCompact(member.createdAt)}
                                        </td>
                                        <td className="px-4 py-3 align-middle">
                                            <div className="flex min-h-8 items-center justify-end gap-2">
                                                {member.role === 'OWNER' ? (
                                                    <span aria-hidden="true" className="block h-0 w-0"></span>
                                                ) : canManage ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setMemberToRemove(member)}
                                                        className="text-sm font-medium text-red-600 hover:text-red-700"
                                                    >
                                                        {t('common.remove')}
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-gray-400">{t('team.members.readOnly')}</span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {success && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {success}
                </div>
            )}
            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}
        </section>
    );
}

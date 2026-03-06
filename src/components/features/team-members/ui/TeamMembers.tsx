'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { CustomSelect, Modal } from '@/components/shared';
import { useI18n } from '@/i18n';
import { formatDateTimeCompact } from '@/utils/dateFormatter';

interface TeamMembersProps {
    teamId: string;
    teamRole: 'OWNER' | 'ADMIN' | 'MEMBER';
}

interface Member {
    id: string;
    userId: string;
    email: string | null;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    createdAt: string;
    updatedAt: string;
}

interface Invite {
    id: string;
    email: string;
    role: 'ADMIN' | 'MEMBER';
    status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELED' | 'EXPIRED';
    expiresAt: string;
    invitedByEmail?: string | null;
    createdAt: string;
}

type MemberRow =
    | {
        kind: 'member';
        id: string;
        email: string | null;
        role: 'OWNER' | 'ADMIN' | 'MEMBER';
        status: 'ACTIVE';
        createdAt: string;
        updatedAt: string;
      }
    | {
        kind: 'invite';
        id: string;
        email: string;
        role: 'ADMIN' | 'MEMBER';
        status: 'INVITED';
        createdAt: string;
        expiresAt: string;
      };

export default function TeamMembers({ teamId, teamRole }: TeamMembersProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [members, setMembers] = useState<Member[]>([]);
    const [invites, setInvites] = useState<Invite[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
    const [inviteToCancel, setInviteToCancel] = useState<Invite | null>(null);

    const canManage = teamRole === 'OWNER' || teamRole === 'ADMIN';
    const roleOptions = useMemo(
        () => [
            { value: 'MEMBER' as const, label: t('team.members.roles.member') },
            { value: 'ADMIN' as const, label: t('team.members.roles.admin') },
        ],
        [t]
    );

    const rows = useMemo<MemberRow[]>(
        () => [
            ...members.map((member) => ({
                kind: 'member' as const,
                id: member.id,
                email: member.email,
                role: member.role,
                status: 'ACTIVE' as const,
                createdAt: member.createdAt,
                updatedAt: member.updatedAt,
            })),
            ...invites.map((invite) => ({
                kind: 'invite' as const,
                id: invite.id,
                email: invite.email,
                role: invite.role,
                status: 'INVITED' as const,
                createdAt: invite.createdAt,
                expiresAt: invite.expiresAt,
            })),
        ],
        [invites, members]
    );

    const loadData = useCallback(async () => {
        try {
            setIsLoading(true);
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
            const [membersResponse, invitesResponse] = await Promise.all([
                fetch(`/api/teams/${teamId}/members`, { headers }),
                fetch(`/api/teams/${teamId}/invites`, { headers }),
            ]);

            if (!membersResponse.ok || !invitesResponse.ok) {
                throw new Error('Failed to load team members');
            }

            const membersData = await membersResponse.json() as { members: Member[] };
            const invitesData = await invitesResponse.json() as { invites: Invite[] };

            setMembers(membersData.members);
            setInvites(invitesData.invites.filter((invite) => invite.status === 'PENDING'));
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

    const updateMemberRole = async (memberId: string, role: 'ADMIN' | 'MEMBER') => {
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

            setMembers((current) => current.map((member) => member.id === memberId ? data as Member : member));
            setSuccess(t('team.members.success.role'));
            setError(null);
        } catch {
            setError(t('team.members.error.role'));
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
            setSuccess(t('team.members.success.remove'));
            setError(null);
        } catch {
            setError(t('team.members.error.remove'));
        }
    };

    const submitInvite = async () => {
        if (!inviteEmail.trim()) {
            setError(t('team.members.invites.error.email'));
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${teamId}/invites`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    email: inviteEmail,
                    role: inviteRole,
                })
            });

            const data = await response.json().catch(() => ({ error: t('team.members.invites.error.create') }));
            if (!response.ok) {
                setError(data.error || t('team.members.invites.error.create'));
                return;
            }

            setInviteEmail('');
            setInviteRole('MEMBER');
            setIsInviteModalOpen(false);
            setInvites((current) => [{ ...data, invitedByEmail: null }, ...current]);
            setSuccess(t('team.members.invites.success'));
            setError(null);

            if (typeof data.inviteUrl === 'string' && navigator.clipboard) {
                await navigator.clipboard.writeText(data.inviteUrl);
            }
        } catch {
            setError(t('team.members.invites.error.create'));
        }
    };

    const resendInvite = async (inviteId: string) => {
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${teamId}/invites/${inviteId}/resend`, {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });

            const data = await response.json().catch(() => ({ error: t('team.members.invites.error.resend') }));
            if (!response.ok) {
                setError(data.error || t('team.members.invites.error.resend'));
                return;
            }

            setSuccess(t('team.members.invites.successResent'));
            setError(null);
            await loadData();

            if (typeof data.inviteUrl === 'string' && navigator.clipboard) {
                await navigator.clipboard.writeText(data.inviteUrl);
            }
        } catch {
            setError(t('team.members.invites.error.resend'));
        }
    };

    const cancelInvite = async () => {
        if (!inviteToCancel) {
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${teamId}/invites/${inviteToCancel.id}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });

            const data = await response.json().catch(() => ({ error: t('team.members.invites.error.cancel') }));
            if (!response.ok) {
                setError(data.error || t('team.members.invites.error.cancel'));
                return;
            }

            setInvites((current) => current.filter((invite) => invite.id !== inviteToCancel.id));
            setInviteToCancel(null);
            setSuccess(t('team.members.invites.successCanceled'));
            setError(null);
        } catch {
            setError(t('team.members.invites.error.cancel'));
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
                isOpen={isInviteModalOpen}
                onClose={() => setIsInviteModalOpen(false)}
                title={t('team.members.invites.open')}
                onConfirm={submitInvite}
                confirmText={t('team.members.invites.send')}
                closeOnConfirm={false}
                overlayClassName="items-start pt-16 sm:pt-24"
                panelClassName="max-w-xl overflow-visible"
                contentClassName="overflow-visible"
            >
                <div className="space-y-4 pb-4">
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('team.members.invites.email')}</span>
                        <input
                            type="email"
                            value={inviteEmail}
                            onChange={(event) => setInviteEmail(event.target.value)}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder={t('team.members.invites.emailPlaceholder')}
                        />
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('team.members.role')}</span>
                        <CustomSelect
                            value={inviteRole}
                            options={roleOptions}
                            onChange={setInviteRole}
                            ariaLabel={t('team.members.role')}
                            fullWidth
                            buttonClassName="shadow-none"
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

            <Modal
                isOpen={inviteToCancel !== null}
                onClose={() => setInviteToCancel(null)}
                title={t('team.members.invites.cancelTitle')}
                onConfirm={cancelInvite}
                confirmText={t('team.members.invites.cancelConfirm')}
                confirmVariant="danger"
            >
                <p className="text-sm text-gray-700">
                    {t('team.members.invites.cancelBody', { email: inviteToCancel?.email ?? '' })}
                </p>
            </Modal>

            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">{t('team.members.title')}</h2>
                {canManage && (
                    <button
                        type="button"
                        onClick={() => setIsInviteModalOpen(true)}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                    >
                        {t('team.members.invites.open')}
                    </button>
                )}
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                {rows.length === 0 ? (
                    <div className="px-6 py-12 text-center text-sm text-gray-500">{t('team.members.empty')}</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100 text-sm">
                            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-6 py-3">{t('team.members.table.person')}</th>
                                    <th className="px-6 py-3">{t('team.members.table.status')}</th>
                                    <th className="px-6 py-3">{t('team.members.table.role')}</th>
                                    <th className="px-6 py-3">{t('team.members.table.lastUpdated')}</th>
                                    <th className="px-6 py-3 text-right">{t('team.members.table.actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white text-gray-700">
                                {rows.map((row) => (
                                    <tr key={`${row.kind}-${row.id}`}>
                                        <td className="px-6 py-4 align-top">
                                            <div className="font-medium text-gray-900">
                                                {row.email || t('team.members.unknownEmail')}
                                            </div>
                                            <div className="mt-1 text-xs text-gray-500">
                                                {row.kind === 'member'
                                                    ? t('team.members.joinedAt', { date: formatDateTimeCompact(row.createdAt) })
                                                    : t('team.members.invites.expiresAt', { date: formatDateTimeCompact(row.expiresAt) })}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 align-top">
                                            <span className={row.kind === 'member' ? 'font-medium text-gray-700' : 'font-medium text-amber-700'}>
                                                {row.kind === 'member' ? t('team.members.status.active') : t('team.members.status.invited')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 align-top">
                                            {row.kind === 'member' && canManage && row.role !== 'OWNER' ? (
                                                <CustomSelect
                                                    value={row.role}
                                                    options={roleOptions}
                                                    onChange={(role) => void updateMemberRole(row.id, role)}
                                                    ariaLabel={t('team.members.role')}
                                                    buttonClassName="min-w-28 px-2 py-1 shadow-none"
                                                    menuClassName="min-w-28"
                                                />
                                            ) : (
                                                <span className="text-sm text-gray-500">
                                                    {t(`team.members.roles.${row.role.toLowerCase()}`)}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 align-top text-sm text-gray-500">
                                            {formatDateTimeCompact(row.kind === 'member' ? row.updatedAt : row.createdAt)}
                                        </td>
                                        <td className="px-6 py-4 align-top">
                                            <div className="flex justify-end gap-2">
                                                {row.kind === 'member' ? (
                                                    row.role === 'OWNER' ? (
                                                        <span className="text-sm text-gray-400">{t('team.members.ownerHint')}</span>
                                                    ) : canManage ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const member = members.find((entry) => entry.id === row.id) ?? null;
                                                                setMemberToRemove(member);
                                                            }}
                                                            className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
                                                        >
                                                            {t('common.remove')}
                                                        </button>
                                                    ) : (
                                                        <span className="text-sm text-gray-400">{t('team.members.readOnly')}</span>
                                                    )
                                                ) : canManage ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => void resendInvite(row.id)}
                                                            className="rounded-md border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                                                        >
                                                            {t('team.members.invites.resend')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const invite = invites.find((entry) => entry.id === row.id) ?? null;
                                                                setInviteToCancel(invite);
                                                            }}
                                                            className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
                                                        >
                                                            {t('team.members.invites.cancel')}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span className="text-sm text-gray-400">{t('team.members.readOnly')}</span>
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
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {success}
                </div>
            )}
            {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}
        </section>
    );
}

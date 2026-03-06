'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/shared';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { formatDateTimeCompact } from '@/utils/dateFormatter';

interface ProjectMembersProps {
    projectId: string;
    canManageMembers: boolean;
}

interface Member {
    id: string;
    userId: string;
    email: string | null;
    role: 'ADMIN' | 'MEMBER';
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

export default function ProjectMembers({ projectId, canManageMembers }: ProjectMembersProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [members, setMembers] = useState<Member[]>([]);
    const [invites, setInvites] = useState<Invite[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
    const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);

    const pendingInvites = useMemo(
        () => invites.filter((invite) => invite.status === 'PENDING'),
        [invites]
    );

    useEffect(() => {
        const fetchData = async () => {
            try {
                setIsLoading(true);
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

                const [membersResponse, invitesResponse] = await Promise.all([
                    fetch(`/api/projects/${projectId}/members`, { headers }),
                    fetch(`/api/projects/${projectId}/invites`, { headers }),
                ]);

                if (!membersResponse.ok || !invitesResponse.ok) {
                    throw new Error('Failed to load project members');
                }

                const [membersData, invitesData] = await Promise.all([
                    membersResponse.json() as Promise<Member[]>,
                    invitesResponse.json() as Promise<Invite[]>,
                ]);

                setMembers(membersData);
                setInvites(invitesData);
                setError(null);
            } catch {
                setError(t('project.members.error.load'));
            } finally {
                setIsLoading(false);
            }
        };

        void fetchData();
    }, [getAccessToken, projectId, t]);

    const updateMemberRole = async (memberId: string, role: 'ADMIN' | 'MEMBER') => {
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ role })
            });

            const data = await response.json().catch(() => ({ error: t('project.members.error.role') }));
            if (!response.ok) {
                setError(data.error || t('project.members.error.role'));
                return;
            }

            setMembers((current) => current.map((member) => member.id === memberId ? data as Member : member));
            setError(null);
        } catch {
            setError(t('project.members.error.role'));
        }
    };

    const removeMember = async () => {
        if (!memberToRemove) {
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/projects/${projectId}/members/${memberToRemove.id}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });

            const data = await response.json().catch(() => ({ error: t('project.members.error.remove') }));
            if (!response.ok) {
                setError(data.error || t('project.members.error.remove'));
                return;
            }

            setMembers((current) => current.filter((member) => member.id !== memberToRemove.id));
            setMemberToRemove(null);
            setError(null);
        } catch {
            setError(t('project.members.error.remove'));
        }
    };

    const submitInvite = async () => {
        if (!inviteEmail.trim()) {
            setError(t('project.members.invites.error.email'));
            return;
        }

        setInviteSuccess(null);

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/projects/${projectId}/invites`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    email: inviteEmail,
                    role: inviteRole,
                })
            });

            const data = await response.json().catch(() => ({ error: t('project.members.invites.error.create') }));
            if (!response.ok) {
                setError(data.error || t('project.members.invites.error.create'));
                return;
            }

            setInvites((current) => [{ ...data, invitedByEmail: null }, ...current]);
            setInviteSuccess(t('project.members.invites.success'));
            setInviteEmail('');
            setInviteRole('MEMBER');
            setIsInviteModalOpen(false);
            setError(null);

            if (typeof data.inviteUrl === 'string' && navigator.clipboard) {
                await navigator.clipboard.writeText(data.inviteUrl);
            }
        } catch {
            setError(t('project.members.invites.error.create'));
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <section className="space-y-6">
            <Modal
                isOpen={isInviteModalOpen}
                onClose={() => setIsInviteModalOpen(false)}
                title={t('project.members.invites.title')}
                onConfirm={submitInvite}
                confirmText={t('project.members.invites.send')}
            >
                <div className="space-y-4">
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('project.members.invites.email')}</span>
                        <input
                            type="email"
                            value={inviteEmail}
                            onChange={(event) => setInviteEmail(event.target.value)}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder={t('project.members.invites.emailPlaceholder')}
                        />
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('project.members.role')}</span>
                        <select
                            value={inviteRole}
                            onChange={(event) => setInviteRole(event.target.value as 'ADMIN' | 'MEMBER')}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                        >
                            <option value="MEMBER">{t('project.members.roles.member')}</option>
                            <option value="ADMIN">{t('project.members.roles.admin')}</option>
                        </select>
                    </label>
                </div>
            </Modal>

            <Modal
                isOpen={memberToRemove !== null}
                onClose={() => setMemberToRemove(null)}
                title={t('project.members.remove.title')}
                onConfirm={removeMember}
                confirmText={t('project.members.remove.confirm')}
                confirmVariant="danger"
            >
                <p className="text-sm text-gray-700">
                    {t('project.members.remove.body', { email: memberToRemove?.email ?? '' })}
                </p>
            </Modal>

            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">{t('project.members.title')}</h2>
                        <p className="text-sm text-gray-500">{t('project.members.subtitle')}</p>
                    </div>
                    {canManageMembers && (
                        <button
                            type="button"
                            onClick={() => setIsInviteModalOpen(true)}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                        >
                            {t('project.members.invites.open')}
                        </button>
                    )}
                </div>

                <div className="divide-y divide-gray-100">
                    {members.map((member) => (
                        <div key={member.id} className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,2fr),140px,160px,120px] md:items-center">
                            <div>
                                <div className="font-medium text-gray-900">{member.email || t('project.members.unknownEmail')}</div>
                                <div className="text-xs text-gray-500">{t('project.members.joinedAt', { date: formatDateTimeCompact(member.createdAt) })}</div>
                            </div>
                            <div className="text-sm text-gray-500">{member.role}</div>
                            <div className="text-sm text-gray-500">{formatDateTimeCompact(member.updatedAt)}</div>
                            <div className="flex justify-start gap-2 md:justify-end">
                                {canManageMembers ? (
                                    <>
                                        <select
                                            value={member.role}
                                            onChange={(event) => void updateMemberRole(member.id, event.target.value as 'ADMIN' | 'MEMBER')}
                                            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        >
                                            <option value="ADMIN">{t('project.members.roles.admin')}</option>
                                            <option value="MEMBER">{t('project.members.roles.member')}</option>
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => setMemberToRemove(member)}
                                            className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
                                        >
                                            {t('common.remove')}
                                        </button>
                                    </>
                                ) : (
                                    <span className="text-sm text-gray-400">{t('project.members.readOnly')}</span>
                                )}
                            </div>
                        </div>
                    ))}

                    {members.length === 0 && (
                        <div className="px-6 py-12 text-center text-sm text-gray-500">{t('project.members.empty')}</div>
                    )}
                </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 px-6 py-4">
                    <h3 className="text-base font-semibold text-gray-900">{t('project.members.invites.pendingTitle')}</h3>
                </div>
                <div className="divide-y divide-gray-100">
                    {pendingInvites.map((invite) => (
                        <div key={invite.id} className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,2fr),120px,160px,1fr] md:items-center">
                            <div>
                                <div className="font-medium text-gray-900">{invite.email}</div>
                                <div className="text-xs text-gray-500">{t('project.members.invites.expiresAt', { date: formatDateTimeCompact(invite.expiresAt) })}</div>
                            </div>
                            <div className="text-sm text-gray-500">{invite.role}</div>
                            <div className="text-sm text-gray-500">{formatDateTimeCompact(invite.createdAt)}</div>
                            <div className="text-sm text-gray-500">
                                {invite.invitedByEmail ? t('project.members.invites.sentBy', { email: invite.invitedByEmail }) : t('project.members.invites.pending')}
                            </div>
                        </div>
                    ))}

                    {pendingInvites.length === 0 && (
                        <div className="px-6 py-12 text-center text-sm text-gray-500">{t('project.members.invites.empty')}</div>
                    )}
                </div>
            </div>

            {inviteSuccess && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {inviteSuccess}
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

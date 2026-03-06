'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';

interface InvitePageProps {
    params: Promise<{ token: string }>;
}

interface InviteDetails {
    id: string;
    email: string;
    role: 'ADMIN' | 'MEMBER';
    status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELED' | 'EXPIRED';
    expiresAt: string;
    project: {
        id: string;
        name: string;
        organization: {
            id: string;
            name: string;
        };
    };
}

export default function InviteAcceptancePage({ params }: InvitePageProps) {
    const { token } = use(params);
    const router = useRouter();
    const { isLoggedIn, isLoading: isAuthLoading, login, getAccessToken, user } = useAuth();
    const { t } = useI18n();
    const [invite, setInvite] = useState<InviteDetails | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionSuccess, setActionSuccess] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchInvite = useCallback(async () => {
        try {
            setIsLoading(true);
            const response = await fetch(`/api/invites/${token}`);
            const data = await response.json();

            if (!response.ok) {
                setInvite(null);
                setError(data.error || t('invite.error.load'));
                return;
            }

            setInvite(data);
            setError(null);
        } catch {
            setInvite(null);
            setError(t('invite.error.load'));
        } finally {
            setIsLoading(false);
        }
    }, [t, token]);

    useEffect(() => {
        void fetchInvite();
    }, [fetchInvite]);

    const submitAction = async (action: 'accept' | 'decline') => {
        setActionError(null);
        setActionSuccess(null);
        setIsSubmitting(true);

        try {
            const accessToken = await getAccessToken();
            const response = await fetch(`/api/invites/${token}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
                },
                body: JSON.stringify({ action }),
            });
            const data = await response.json();

            if (!response.ok) {
                setActionError(data.error || t('invite.error.action'));
                return;
            }

            if (action === 'accept' && data.projectId) {
                setActionSuccess(t('invite.success.accepted'));
                router.push(`/projects/${data.projectId}`);
                return;
            }

            setActionSuccess(action === 'accept' ? t('invite.success.accepted') : t('invite.success.declined'));
            await fetchInvite();
        } catch {
            setActionError(t('invite.error.action'));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading || isAuthLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center text-gray-500">
                {t('common.loading')}
            </div>
        );
    }

    if (!invite) {
        return (
            <main className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
                <div className="max-w-lg w-full bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
                    <h1 className="text-2xl font-semibold text-gray-900 mb-3">{t('invite.title')}</h1>
                    <p className="text-sm text-red-600">{error || t('invite.error.load')}</p>
                </div>
            </main>
        );
    }

    const currentUserEmail = typeof user?.email === 'string' ? user.email.toLowerCase() : null;
    const emailMismatch = currentUserEmail !== null && currentUserEmail !== invite.email.toLowerCase();
    const canRespond = invite.status === 'PENDING' && isLoggedIn && !emailMismatch;

    return (
        <main className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-12">
            <div className="max-w-xl w-full bg-white border border-gray-200 rounded-xl shadow-sm p-8 space-y-6">
                <div className="space-y-2">
                    <p className="text-sm font-medium text-blue-600">{t('invite.badge')}</p>
                    <h1 className="text-3xl font-semibold text-gray-900">{t('invite.title')}</h1>
                    <p className="text-sm text-gray-500">{t('invite.subtitle')}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                    <div>
                        <div className="text-gray-500">{t('invite.organization')}</div>
                        <div className="font-medium text-gray-900">{invite.project.organization.name}</div>
                    </div>
                    <div>
                        <div className="text-gray-500">{t('invite.project')}</div>
                        <div className="font-medium text-gray-900">{invite.project.name}</div>
                    </div>
                    <div>
                        <div className="text-gray-500">{t('invite.role')}</div>
                        <div className="font-medium text-gray-900">{invite.role}</div>
                    </div>
                    <div>
                        <div className="text-gray-500">{t('invite.email')}</div>
                        <div className="font-medium text-gray-900 break-all">{invite.email}</div>
                    </div>
                </div>

                {invite.status !== 'PENDING' && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        {t('invite.statusMessage', { status: invite.status.toLowerCase() })}
                    </div>
                )}

                {!isLoggedIn && invite.status === 'PENDING' && (
                    <div className="space-y-3">
                        <p className="text-sm text-gray-600">{t('invite.loginRequired')}</p>
                        <button
                            type="button"
                            onClick={() => login({ redirectTo: `/invites/${token}` })}
                            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
                        >
                            {t('invite.login')}
                        </button>
                    </div>
                )}

                {emailMismatch && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {t('invite.emailMismatch', { email: invite.email })}
                    </div>
                )}

                {actionError && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {actionError}
                    </div>
                )}

                {actionSuccess && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {actionSuccess}
                    </div>
                )}

                {canRespond && (
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => void submitAction('accept')}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50"
                        >
                            {t('invite.accept')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void submitAction('decline')}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                        >
                            {t('invite.decline')}
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}

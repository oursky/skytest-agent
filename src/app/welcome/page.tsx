'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useTeams } from '@/hooks/useTeams';
import { useCurrentTeam } from '@/hooks/useCurrentTeam';
import { useI18n } from '@/i18n';

export default function WelcomePage() {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const { t } = useI18n();
    const { teams, loading: isTeamsLoading, refresh: refreshTeams } = useTeams(getAccessToken, isLoggedIn);
    const { setCurrentTeam } = useCurrentTeam(getAccessToken, false);
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push('/');
            return;
        }

        if (!isTeamsLoading && teams.length > 0) {
            router.push('/projects');
        }
    }, [isAuthLoading, isLoggedIn, isTeamsLoading, teams.length, router]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!name.trim()) {
            setError(t('welcome.error.required'));
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const token = await getAccessToken();
            const response = await fetch('/api/teams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ name })
            });

            const data = await response.json().catch(() => ({ error: t('welcome.error.create') }));
            if (!response.ok || typeof data.id !== 'string') {
                setError(data.error || t('welcome.error.create'));
                return;
            }

            await setCurrentTeam(data.id);
            await refreshTeams();
            router.push('/projects');
        } catch {
            setError(t('welcome.error.create'));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isAuthLoading || isTeamsLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                <div className="space-y-3">
                    <p className="text-sm font-medium text-blue-600">{t('welcome.badge')}</p>
                    <h1 className="text-3xl font-semibold text-gray-900">{t('welcome.title')}</h1>
                </div>

                <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('welcome.teamName')}</span>
                        <input
                            type="text"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder={t('welcome.placeholder')}
                            className="w-full rounded-md border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                            autoFocus
                        />
                    </label>

                    {error && <p className="text-sm text-red-600">{error}</p>}

                    <button
                        type="submit"
                        disabled={isSubmitting || !name.trim()}
                        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                        {t('welcome.create')}
                    </button>
                </form>
            </div>
        </main>
    );
}

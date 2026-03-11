'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { Button, CenteredLoading } from '@/components/shared';
import { useTeams } from '@/hooks/team/useTeams';
import { useCurrentTeam } from '@/hooks/team/useCurrentTeam';
import { useI18n } from '@/i18n';
import { useCreateTeam } from '@/hooks/team/useCreateTeam';

export default function WelcomePage() {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const { t } = useI18n();
    const { teams, loading: isTeamsLoading, refresh: refreshTeams } = useTeams(getAccessToken, isLoggedIn);
    const { setCurrentTeam } = useCurrentTeam(getAccessToken, false);
    const { createTeam, isSubmitting } = useCreateTeam({
        getAccessToken,
        refreshTeams,
        setCurrentTeam,
    });
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);

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

        setError(null);

        const result = await createTeam(name, t('welcome.error.create'));
        if (!result.teamId) {
            setError(result.error || t('welcome.error.create'));
            return;
        }

        router.push('/projects');
    };

    if (isAuthLoading || isTeamsLoading) {
        return <CenteredLoading className="min-h-screen" />;
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

                    <Button
                        type="submit"
                        disabled={isSubmitting || !name.trim()}
                        variant="primary"
                        size="sm"
                    >
                        {t('welcome.create')}
                    </Button>
                </form>
            </div>
        </main>
    );
}

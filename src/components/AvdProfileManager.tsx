'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';

interface AvdProfileRecord {
    id: string;
    name: string;
    displayName: string;
    apiLevel: number | null;
    screenSize: string | null;
    enabled: boolean;
}

interface AvdProfileManagerProps {
    projectId: string;
}

export default function AvdProfileManager({ projectId }: AvdProfileManagerProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [profiles, setProfiles] = useState<AvdProfileRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [androidDisabled, setAndroidDisabled] = useState(false);

    const fetchProfiles = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/projects/${projectId}/avd-profiles`, { headers });

            if (res.status === 403) {
                setAndroidDisabled(true);
                setIsLoading(false);
                return;
            }

            if (!res.ok) throw new Error('Failed to load AVD profiles');
            const data = await res.json() as AvdProfileRecord[];
            setProfiles(data);
        } catch (err) {
            console.error('Failed to fetch AVD profiles:', err);
        } finally {
            setIsLoading(false);
        }
    }, [projectId, getAccessToken]);

    useEffect(() => {
        void fetchProfiles();
    }, [fetchProfiles]);

    if (androidDisabled) {
        return (
            <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                {t('feature.android.disabled')}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">{t('avdProfile.title')}</h2>
            </div>

            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 space-y-1">
                <p>{t('avdProfile.help.intro')}</p>
                <p>{t('avdProfile.help.setup')}</p>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                ) : profiles.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-400">
                        {t('avdProfile.empty')}
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {profiles.map(profile => (
                            <div key={profile.id} className="px-4 py-3">
                                <div className="text-sm font-medium text-gray-900 truncate">{profile.displayName}</div>
                                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                    <span className="text-xs text-gray-500 font-mono">{profile.name}</span>
                                    {profile.apiLevel !== null && (
                                        <span className="text-xs text-gray-400">API {profile.apiLevel}</span>
                                    )}
                                    {profile.screenSize && (
                                        <span className="text-xs text-gray-400">{profile.screenSize}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import Modal from '@/components/Modal';

interface AvdProfileRecord {
    id: string;
    name: string;
    displayName: string;
    apiLevel: number;
    screenSize: string | null;
    dockerImage: string | null;
    enabled: boolean;
    createdAt: string;
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
    const [showForm, setShowForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        displayName: '',
        apiLevel: '',
        screenSize: '',
        dockerImage: '',
    });
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; profileId: string; displayName: string }>({
        isOpen: false, profileId: '', displayName: ''
    });
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

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

    const handleCreate = async () => {
        setCreating(true);
        setCreateError(null);

        const apiLevel = parseInt(formData.apiLevel, 10);
        if (!formData.name.trim() || !formData.displayName.trim() || isNaN(apiLevel) || apiLevel < 1) {
            setCreateError('name, displayName, and a valid apiLevel are required');
            setCreating(false);
            return;
        }

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            };
            const res = await fetch(`/api/projects/${projectId}/avd-profiles`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: formData.name.trim(),
                    displayName: formData.displayName.trim(),
                    apiLevel,
                    screenSize: formData.screenSize.trim() || undefined,
                    dockerImage: formData.dockerImage.trim() || undefined,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error || 'Create failed');
            }

            const newProfile = await res.json() as AvdProfileRecord;
            setProfiles(prev => [newProfile, ...prev]);
            setShowForm(false);
            setFormData({ name: '', displayName: '', apiLevel: '', screenSize: '', dockerImage: '' });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Create failed';
            setCreateError(msg);
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteConfirm = async () => {
        setDeleting(true);
        setDeleteError(null);
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/projects/${projectId}/avd-profiles/${deleteModal.profileId}`, {
                method: 'DELETE',
                headers,
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error || 'Delete failed');
            }

            setProfiles(prev => prev.filter(p => p.id !== deleteModal.profileId));
            setDeleteModal({ isOpen: false, profileId: '', displayName: '' });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Delete failed';
            setDeleteError(msg);
            console.error('AVD profile delete failed:', err);
        } finally {
            setDeleting(false);
        }
    };

    if (androidDisabled) {
        return (
            <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                {t('feature.android.disabled')}
            </div>
        );
    }

    return (
        <>
            <Modal
                isOpen={deleteModal.isOpen}
                onClose={() => { setDeleteModal({ isOpen: false, profileId: '', displayName: '' }); setDeleteError(null); }}
                title={t('avdProfile.delete.confirm')}
                onConfirm={handleDeleteConfirm}
                confirmText={t('common.delete')}
                confirmVariant="danger"
            >
                <div className="text-gray-700">
                    <p>{t('avdProfile.delete.confirm')}</p>
                    <p className="mt-1 text-sm text-gray-500 font-mono">{deleteModal.displayName}</p>
                    {deleteError && (
                        <p className="mt-2 text-sm text-red-600">{deleteError}</p>
                    )}
                </div>
            </Modal>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">{t('avdProfile.title')}</h2>
                    <button
                        type="button"
                        onClick={() => { setShowForm(!showForm); setCreateError(null); }}
                        className="px-3 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2 cursor-pointer"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        {t('avdProfile.add')}
                    </button>
                </div>

                {showForm && (
                    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('avdProfile.name')}</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Pixel_7_API_34"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('avdProfile.displayName')}</label>
                                <input
                                    type="text"
                                    value={formData.displayName}
                                    onChange={e => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                                    placeholder="Pixel 7 (Android 14)"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('avdProfile.apiLevel')}</label>
                                <input
                                    type="number"
                                    value={formData.apiLevel}
                                    onChange={e => setFormData(prev => ({ ...prev, apiLevel: e.target.value }))}
                                    placeholder="34"
                                    min="1"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('avdProfile.screenSize')}</label>
                                <input
                                    type="text"
                                    value={formData.screenSize}
                                    onChange={e => setFormData(prev => ({ ...prev, screenSize: e.target.value }))}
                                    placeholder="1080x2400"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('avdProfile.dockerImage')}</label>
                                <input
                                    type="text"
                                    value={formData.dockerImage}
                                    onChange={e => setFormData(prev => ({ ...prev, dockerImage: e.target.value }))}
                                    placeholder="budtmo/docker-android:emulator_34.0"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        </div>

                        {createError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                                {createError}
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => { setShowForm(false); setCreateError(null); }}
                                className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleCreate()}
                                disabled={creating}
                                className="px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {creating && (
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                )}
                                {creating ? t('avdProfile.creating') : t('avdProfile.create')}
                            </button>
                        </div>
                    </div>
                )}

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
                                <div key={profile.id} className="px-4 py-3 flex items-center justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-gray-900 truncate">{profile.displayName}</div>
                                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                            <span className="text-xs text-gray-500 font-mono">{profile.name}</span>
                                            <span className="text-xs text-gray-400">API {profile.apiLevel}</span>
                                            {profile.screenSize && (
                                                <span className="text-xs text-gray-400">{profile.screenSize}</span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setDeleteModal({ isOpen: true, profileId: profile.id, displayName: profile.displayName })}
                                        className="p-1.5 text-gray-400 hover:text-red-600 transition-colors shrink-0"
                                        title={t('common.delete')}
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { useApkUpload } from '@/hooks/useApkUpload';
import { formatDateTime } from '@/utils/dateFormatter';
import Modal from '@/components/Modal';

interface ApkRecord {
    id: string;
    filename: string;
    packageName: string;
    activityName?: string | null;
    versionName?: string | null;
    size: number;
    createdAt: string;
}

interface ApkManagerProps {
    projectId: string;
}

export default function ApkManager({ projectId }: ApkManagerProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [apks, setApks] = useState<ApkRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [androidDisabled, setAndroidDisabled] = useState(false);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; apkId: string; filename: string }>({
        isOpen: false, apkId: '', filename: ''
    });
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const { triggerUpload, uploading, error: uploadError, fileInputProps } = useApkUpload(projectId, getAccessToken);

    const fetchApks = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/projects/${projectId}/apks`, { headers });

            if (res.status === 403) {
                setAndroidDisabled(true);
                setIsLoading(false);
                return;
            }

            if (!res.ok) throw new Error('Failed to load APKs');
            const data = await res.json() as ApkRecord[];
            setApks(data);
        } catch (err) {
            console.error('Failed to fetch APKs:', err);
        } finally {
            setIsLoading(false);
        }
    }, [projectId, getAccessToken]);

    useEffect(() => {
        void fetchApks();
    }, [fetchApks]);

    const handleUpload = () => {
        triggerUpload((newApk) => {
            setApks(prev => [newApk, ...prev]);
        });
    };

    const handleDeleteConfirm = async () => {
        setDeleting(true);
        setDeleteError(null);
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token
                ? { 'Authorization': `Bearer ${token}` }
                : {};
            const res = await fetch(`/api/projects/${projectId}/apks/${deleteModal.apkId}`, {
                method: 'DELETE',
                headers,
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error || 'Delete failed');
            }

            setApks(prev => prev.filter(a => a.id !== deleteModal.apkId));
            setDeleteModal({ isOpen: false, apkId: '', filename: '' });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Delete failed';
            setDeleteError(msg);
            console.error('APK delete failed:', err);
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
            <input {...fileInputProps} />

            <Modal
                isOpen={deleteModal.isOpen}
                onClose={() => { setDeleteModal({ isOpen: false, apkId: '', filename: '' }); setDeleteError(null); }}
                title={t('apk.delete.confirm')}
                onConfirm={handleDeleteConfirm}
                confirmText={t('common.delete')}
                confirmVariant="danger"
            >
                <div className="text-gray-700">
                    <p>{t('apk.delete.confirm')}</p>
                    <p className="mt-1 text-sm text-gray-500 font-mono">{deleteModal.filename}</p>
                    {deleteError && (
                        <p className="mt-2 text-sm text-red-600">{deleteError}</p>
                    )}
                </div>
            </Modal>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">APKs</h2>
                    <button
                        type="button"
                        onClick={handleUpload}
                        disabled={uploading}
                        className="px-3 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {uploading ? (
                            <>
                                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                {t('apk.uploading')}
                            </>
                        ) : (
                            <>
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                {t('apk.upload')}
                            </>
                        )}
                    </button>
                </div>

                {uploadError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                        {uploadError}
                    </div>
                )}

                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                        </div>
                    ) : apks.length === 0 ? (
                        <div className="p-8 text-center text-sm text-gray-400">
                            {t('apk.empty')}
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {apks.map(apk => (
                                <div key={apk.id} className="px-4 py-3 flex items-center justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-gray-900 truncate">{apk.filename}</div>
                                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                            {apk.packageName && (
                                                <span className="text-xs text-gray-500 font-mono">{apk.packageName}</span>
                                            )}
                                            {apk.activityName && (
                                                <span className="text-xs text-gray-400 font-mono">.{apk.activityName.split('.').pop()}</span>
                                            )}
                                            {apk.versionName && (
                                                <span className="text-xs text-gray-400">{apk.versionName}</span>
                                            )}
                                            <span className="text-xs text-gray-400">
                                                {t('apk.size', { size: (apk.size / 1024 / 1024).toFixed(1) })}
                                            </span>
                                            <span className="text-xs text-gray-400">{formatDateTime(apk.createdAt)}</span>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setDeleteModal({ isOpen: true, apkId: apk.id, filename: apk.filename })}
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

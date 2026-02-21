'use client';

import { useRef, useState, useCallback } from 'react';

interface ApkRecord {
    id: string;
    filename: string;
    packageName: string;
    activityName?: string;
    versionName?: string;
    size: number;
    createdAt: string;
}

interface UseApkUploadReturn {
    triggerUpload: (onSuccess: (apk: ApkRecord) => void) => void;
    uploading: boolean;
    error: string | null;
    fileInputProps: {
        ref: React.RefObject<HTMLInputElement | null>;
        type: 'file';
        accept: string;
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
        className: string;
    };
}

export function useApkUpload(projectId: string, getAccessToken: () => Promise<string | null>): UseApkUploadReturn {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const onSuccessRef = useRef<((apk: ApkRecord) => void) | null>(null);

    const triggerUpload = useCallback((onSuccess: (apk: ApkRecord) => void) => {
        onSuccessRef.current = onSuccess;
        fileInputRef.current?.click();
    }, []);

    const handleChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        e.target.value = '';
        setError(null);
        setUploading(true);

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch(`/api/projects/${projectId}/apks`, {
                method: 'POST',
                headers,
                body: formData,
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error || 'Upload failed');
            }

            const apk = await res.json() as ApkRecord;
            onSuccessRef.current?.(apk);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Upload failed';
            setError(msg);
            console.error('APK upload failed:', err);
        } finally {
            setUploading(false);
        }
    }, [projectId, getAccessToken]);

    return {
        triggerUpload,
        uploading,
        error,
        fileInputProps: {
            ref: fileInputRef,
            type: 'file',
            accept: '.apk',
            onChange: handleChange,
            className: 'hidden',
        },
    };
}

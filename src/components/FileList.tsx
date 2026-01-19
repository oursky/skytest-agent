'use client';

import { TestCaseFile } from '@/types';
import { config } from '@/config/app';
import { useAuth } from '@/app/auth-provider';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';

interface FileListProps {
    files: TestCaseFile[];
    testCaseId: string;
    onDelete?: (fileId: string) => void;
    readOnly?: boolean;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string): React.ReactNode {
    if (mimeType.startsWith('image/')) {
        return (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
        );
    }
    if (mimeType === 'application/pdf') {
        return (
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
        );
    }
    if (mimeType === 'application/zip') {
        return (
            <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
        );
    }
    if (mimeType.includes('word') || mimeType.includes('document')) {
        return (
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
        );
    }
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
        return (
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
        );
    }
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) {
        return (
            <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6" />
            </svg>
        );
    }
    return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
    );
}

export default function FileList({ files, testCaseId, onDelete, readOnly }: FileListProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [token, setToken] = useState<string | null>(null);
    const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});

    useEffect(() => {
        (async () => {
            const t = await getAccessToken();
            setToken(t);
        })();
    }, [getAccessToken]);
    if (files.length === 0) {
        return null;
    }

    const handleDownload = (file: TestCaseFile) => {
        const params = new URLSearchParams();
        if (token) params.set('token', token);
        if (readOnly) params.set('storedName', file.storedName);
        const queryString = params.toString();
        const url = `/api/test-cases/${testCaseId}/files/${file.id}${queryString ? `?${queryString}` : ''}`;
        window.open(url, '_blank');
    };

    const handleDelete = async (fileId: string) => {
        try {
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${testCaseId}/files/${fileId}`, {
                method: 'DELETE',
                headers,
            });

            if (!response.ok) {
                throw new Error(t('file.deleteFailed'));
            }

            onDelete?.(fileId);
        } catch (error) {
            console.error('Failed to delete file:', error);
            alert(t('file.deleteFailed'));
        }
    };

    const copyPath = async (fileId: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedMap(prev => ({ ...prev, [fileId]: true }));
            window.setTimeout(() => {
                setCopiedMap(prev => ({ ...prev, [fileId]: false }));
            }, 1200);
        } catch {
            // ignore
        }
    };

    const uploadRoot = config.files.uploadDir.replace(/^\.?\//, '');

    return (
        <div className="space-y-2 overflow-x-hidden">
            <div className="grid gap-2 overflow-x-hidden">
                {files.map((file) => {
                    const relativePath = `${uploadRoot}/${testCaseId}/${file.storedName}`;

                    return (
                        <div
                            key={file.id}
                            className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors overflow-hidden"
                        >
                            {file.mimeType.startsWith('image/') && !readOnly && token ? (
                                <img
                                    src={`/api/test-cases/${testCaseId}/files/${file.id}?inline=1&token=${token}`}
                                    alt={file.filename}
                                    className="w-12 h-12 object-cover rounded border border-gray-200"
                                />
                            ) : (
                                <div className="text-gray-400">
                                    {getFileIcon(file.mimeType)}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-700 truncate">{file.filename}</p>
                                <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
                                {!readOnly && (
                                    <div className="mt-1 flex items-center gap-2 min-w-0">
                                        <code
                                            className="text-[10px] text-gray-500 bg-white border border-gray-200 px-1.5 py-0.5 rounded truncate max-w-[60%] md:max-w-[70%]"
                                            title={relativePath}
                                        >
                                            {relativePath}
                                        </code>
                                        <button
                                            type="button"
                                            onClick={() => copyPath(file.id, relativePath)}
                                            className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded"
                                            title={t('file.copyPath')}
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                        </button>
                                        {copiedMap[file.id] && (
                                            <span className="text-[10px] text-gray-600 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">
                                                {t('common.copied')}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => handleDownload(file)}
                                    className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                                    title={t('file.download')}
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                </button>
                                {!readOnly && onDelete && (
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(file.id)}
                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                        title={t('file.delete')}
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

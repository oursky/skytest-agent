'use client';

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useAuth } from '@/app/auth-provider';
import type { TestCaseFile } from '@/types';
import { config } from '@/config/app';
import { useI18n } from '@/i18n';

interface FileUploadZoneProps {
    testCaseId?: string;
    onUploadComplete: (testCaseId: string, uploadedFiles: TestCaseFile[]) => void | Promise<void>;
    disabled?: boolean;
    ensureTestCase?: () => Promise<string>;
    compact?: boolean;
}

export interface FileUploadZoneHandle { open: () => void }

function FileUploadZoneInner({ testCaseId, onUploadComplete, disabled, ensureTestCase, compact }: FileUploadZoneProps, ref: React.Ref<FileUploadZoneHandle>) {
    const { t } = useI18n();

    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [effectiveTestCaseId, setEffectiveTestCaseId] = useState<string | undefined>(testCaseId);
    const { getAccessToken } = useAuth();

    useImperativeHandle(ref, () => ({
        open: () => {
            if (!disabled) fileInputRef.current?.click();
        }
    }), [disabled]);

    useEffect(() => {
        setEffectiveTestCaseId(testCaseId);
    }, [testCaseId]);

    const validateFile = (file: File): string | null => {
        if (file.size > config.files.maxFileSize) {
            const maxMB = Math.floor(config.files.maxFileSize / 1024 / 1024);
            return t('upload.error.fileTooLarge', { name: file.name, mb: maxMB });
        }
        if (!config.files.allowedMimeTypes.includes(file.type)) {
            return t('upload.error.fileTypeNotAllowed', { type: file.type });
        }
        return null;
    };

    const uploadFile = async (file: File, id: string) => {
        if (!id) throw new Error(t('upload.error.noTestCase'));
        const formData = new FormData();
        formData.append('file', file);
        const token = await getAccessToken();
        const response = await fetch(`/api/test-cases/${id}/files`, {
            method: 'POST',
            body: formData,
            headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || t('upload.error.uploadFailed'));
        }

        return response.json();
    };

    const handleFiles = useCallback(async (files: FileList | null) => {
        const fileArray = files ? Array.from(files) : [];
        if (fileArray.length === 0) return;

        setError(null);
        setIsUploading(true);

        try {
            let uploadTargetId = effectiveTestCaseId;
            if (!uploadTargetId) {
                if (!ensureTestCase) throw new Error(t('upload.error.noTestCaseAttach'));
                const newId = await ensureTestCase();
                if (!newId) throw new Error(t('upload.error.failedCreateTestCase'));
                uploadTargetId = newId;
                setEffectiveTestCaseId(newId);
            }
            const uploaded: TestCaseFile[] = [];

            for (const file of fileArray) {
                const validationError = validateFile(file);
                if (validationError) {
                    setError(validationError);
                    continue;
                }
                const uploadedFile = await uploadFile(file, uploadTargetId) as TestCaseFile;
                uploaded.push(uploadedFile);
            }

            await onUploadComplete(uploadTargetId, uploaded);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('upload.error.uploadFailed'));
        } finally {
            setIsUploading(false);
        }
    }, [effectiveTestCaseId, onUploadComplete, ensureTestCase]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
    }, [disabled]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
    }, [disabled, handleFiles]);

    const handleClick = () => {
        if (!disabled) fileInputRef.current?.click();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleFiles(e.target.files);
        e.target.value = '';
    };

    if (compact) {
        return (
            <>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleInputChange}
                    accept={config.files.allowedExtensions.join(',')}
                    className="hidden"
                    disabled={disabled}
                />
                {error && (
                    <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-2">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {error}
                    </div>
                )}
            </>
        );
    }

    return (
        <div className="space-y-2">
            <div
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
                    relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
                    ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:border-indigo-400 hover:bg-indigo-50/30'}
                    ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300'}
                    ${isUploading ? 'pointer-events-none' : ''}
                `}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleInputChange}
                    accept={config.files.allowedExtensions.join(',')}
                    className="hidden"
                    disabled={disabled}
                />

                {isUploading ? (
                    <div className="flex flex-col items-center gap-2">
                        <svg className="w-8 h-8 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span className="text-sm text-gray-500">{t('upload.uploading')}</span>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-2">
                        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <div>
                            <span className="text-sm font-medium text-indigo-600">{t('upload.clickToUpload')}</span>
                            <span className="text-sm text-gray-500">{t('upload.orDragDrop')}</span>
                        </div>
                        <span className="text-xs text-gray-400">
                            {t('upload.maxPerFile', { mb: Math.floor(config.files.maxFileSize / 1024 / 1024) })}
                        </span>
                    </div>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                </div>
            )}
        </div>
    );
}

const FileUploadZone = forwardRef<FileUploadZoneHandle, FileUploadZoneProps>(FileUploadZoneInner);
export default FileUploadZone;

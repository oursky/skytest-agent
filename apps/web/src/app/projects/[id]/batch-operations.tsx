import type React from 'react';
import type { TestCaseImportReviewData } from '@/components/features/test-cases/ui/TestCaseImportReviewDialog';
import type { SortColumn } from './project-page.types';

export type BatchImportMode = 'validate' | 'import-valid' | 'import-all-draft';

export interface BatchImportResponse extends TestCaseImportReviewData {
    mode: BatchImportMode;
}

export function extractFilenameFromContentDisposition(headerValue: string | null, fallbackName: string): string {
    if (!headerValue) {
        return fallbackName;
    }
    const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        try {
            return decodeURIComponent(utf8Match[1].replace(/["']/g, '').trim());
        } catch {
            return utf8Match[1].replace(/["']/g, '').trim();
        }
    }
    const asciiMatch = headerValue.match(/filename="?([^";]+)"?/i);
    if (!asciiMatch?.[1]) {
        return fallbackName;
    }
    return asciiMatch[1].trim();
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

export function SortIcon(input: {
    column: SortColumn;
    sortColumn: SortColumn;
    sortDirection: 'asc' | 'desc';
}) {
    const { column, sortColumn, sortDirection } = input;
    if (sortColumn !== column) {
        return (
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
        );
    }
    return sortDirection === 'asc' ? (
        <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
    ) : (
        <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
    );
}

export async function runBatchImportRequestHelper(input: {
    getAccessToken: () => Promise<string | undefined | null>;
    projectId: string;
    file: File;
    mode: BatchImportMode;
}): Promise<BatchImportResponse> {
    const { getAccessToken, projectId, file, mode } = input;
    const token = await getAccessToken();
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const formData = new FormData();
    formData.append('mode', mode);
    formData.append('file', file);

    const response = await fetch(`/api/projects/${projectId}/test-cases/batch-import`, {
        method: 'POST',
        headers,
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Batch import request failed (${response.status})`);
    }

    return await response.json() as BatchImportResponse;
}

export async function handleExportSelectedHelper(input: {
    getAccessToken: () => Promise<string | undefined | null>;
    projectId: string;
    selectedTestCaseIds: Set<string>;
    fallbackProjectName: string;
}): Promise<void> {
    const { getAccessToken, projectId, selectedTestCaseIds, fallbackProjectName } = input;
    const token = await getAccessToken();
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const response = await fetch(`/api/projects/${projectId}/test-cases/export`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ testCaseIds: Array.from(selectedTestCaseIds) }),
    });

    if (!response.ok) {
        throw new Error(`Export request failed (${response.status})`);
    }

    const blob = await response.blob();
    const filename = extractFilenameFromContentDisposition(
        response.headers.get('Content-Disposition'),
        `${fallbackProjectName}_selected_test_cases.zip`
    );
    downloadBlob(blob, filename);
}

export async function handleBatchImportZipHelper(input: {
    file: File;
    runBatchImportRequest: (file: File, mode: BatchImportMode) => Promise<BatchImportResponse>;
    fetchTestCases: () => Promise<void>;
    setBatchImportReviewData: React.Dispatch<React.SetStateAction<BatchImportResponse | null>>;
    setPendingBatchImportFile: React.Dispatch<React.SetStateAction<File | null>>;
    setIsBatchImportProcessing: React.Dispatch<React.SetStateAction<boolean>>;
}): Promise<void> {
    const {
        file,
        runBatchImportRequest,
        fetchTestCases,
        setBatchImportReviewData,
        setPendingBatchImportFile,
        setIsBatchImportProcessing,
    } = input;

    setIsBatchImportProcessing(true);
    try {
        const validationResult = await runBatchImportRequest(file, 'validate');
        const hasIncomplete = validationResult.summary.incompleteFiles > 0;
        const hasInvalid = validationResult.summary.invalidFiles > 0;

        // Everything is complete — import straight away without prompting.
        if (!hasIncomplete && !hasInvalid) {
            await runBatchImportRequest(file, 'import-valid');
            await fetchTestCases();
            setBatchImportReviewData(null);
            setPendingBatchImportFile(null);
            return;
        }

        setBatchImportReviewData(validationResult);
        setPendingBatchImportFile(file);
    } catch (error) {
        console.error('Failed to validate batch import', error);
    } finally {
        setIsBatchImportProcessing(false);
    }
}

export async function runPendingBatchImportHelper(input: {
    pendingBatchImportFile: File | null;
    mode: 'import-valid' | 'import-all-draft';
    runBatchImportRequest: (file: File, mode: BatchImportMode) => Promise<BatchImportResponse>;
    fetchTestCases: () => Promise<void>;
    setBatchImportReviewData: React.Dispatch<React.SetStateAction<BatchImportResponse | null>>;
    setPendingBatchImportFile: React.Dispatch<React.SetStateAction<File | null>>;
    setIsBatchImportProcessing: React.Dispatch<React.SetStateAction<boolean>>;
}): Promise<void> {
    const {
        pendingBatchImportFile,
        mode,
        runBatchImportRequest,
        fetchTestCases,
        setBatchImportReviewData,
        setPendingBatchImportFile,
        setIsBatchImportProcessing,
    } = input;

    if (!pendingBatchImportFile) {
        setBatchImportReviewData(null);
        return;
    }

    setIsBatchImportProcessing(true);
    try {
        await runBatchImportRequest(pendingBatchImportFile, mode);
        await fetchTestCases();
        setBatchImportReviewData(null);
        setPendingBatchImportFile(null);
    } catch (error) {
        console.error('Failed to import batch records', error);
    } finally {
        setIsBatchImportProcessing(false);
    }
}

export function handleDiscardBatchImportHelper(input: {
    setBatchImportReviewData: React.Dispatch<React.SetStateAction<BatchImportResponse | null>>;
    setPendingBatchImportFile: React.Dispatch<React.SetStateAction<File | null>>;
}): void {
    input.setBatchImportReviewData(null);
    input.setPendingBatchImportFile(null);
}

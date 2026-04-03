import type React from 'react';
import type { ParsedTestCaseExcel } from '@/utils/excel/testCaseExcel';
import type { TestCaseImportReviewData } from '@/components/features/test-cases/ui/TestCaseImportReviewDialog';

interface ReviewIssue {
    code: string;
    severity: 'warning' | 'error';
    reason: string;
    sheet?: string;
    row?: number;
}

export function buildImportReviewData(
    filename: string,
    issues: ReviewIssue[]
): TestCaseImportReviewData {
    const hasErrors = issues.some((issue) => issue.severity === 'error');
    const hasWarnings = issues.some((issue) => issue.severity === 'warning');
    return {
        summary: {
            totalFiles: 1,
            validFiles: hasErrors ? 0 : 1,
            invalidFiles: hasErrors ? 1 : 0,
            warningFiles: hasWarnings ? 1 : 0,
            importedFiles: 0,
            skippedFiles: 0,
        },
        files: [{
            filename,
            status: hasErrors ? 'invalid' : 'valid',
            issues: issues.map((issue) => ({
                ...issue,
                filename,
            })),
        }],
    };
}

export async function handleProceedImportReviewHelper(input: {
    pendingImportData: ParsedTestCaseExcel | null;
    setImportReviewData: React.Dispatch<React.SetStateAction<TestCaseImportReviewData | null>>;
    setPendingImportData: React.Dispatch<React.SetStateAction<ParsedTestCaseExcel | null>>;
    setIsImportReviewProcessing: React.Dispatch<React.SetStateAction<boolean>>;
    applyImportedExcelData: (data: ParsedTestCaseExcel) => Promise<void>;
}): Promise<void> {
    const {
        pendingImportData,
        setImportReviewData,
        setPendingImportData,
        setIsImportReviewProcessing,
        applyImportedExcelData,
    } = input;

    if (!pendingImportData) {
        setImportReviewData(null);
        return;
    }

    setIsImportReviewProcessing(true);
    try {
        await applyImportedExcelData(pendingImportData);
        setImportReviewData(null);
        setPendingImportData(null);
    } catch (error) {
        console.error('Failed to import test case', error);
    } finally {
        setIsImportReviewProcessing(false);
    }
}

export function discardImportReviewHelper(input: {
    setImportReviewData: React.Dispatch<React.SetStateAction<TestCaseImportReviewData | null>>;
    setPendingImportData: React.Dispatch<React.SetStateAction<ParsedTestCaseExcel | null>>;
}): void {
    input.setImportReviewData(null);
    input.setPendingImportData(null);
}

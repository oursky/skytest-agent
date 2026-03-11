'use client';

import Modal from '@/components/shared/Modal';
import { useI18n } from '@/i18n';

export interface TestCaseImportIssue {
    code: string;
    severity: 'warning' | 'error';
    reason: string;
    sheet?: string;
    row?: number;
    filename: string;
}

export interface TestCaseImportFileReport {
    filename: string;
    status: 'valid' | 'invalid' | 'imported' | 'skipped';
    issues: TestCaseImportIssue[];
}

export interface TestCaseImportReviewData {
    summary: {
        totalFiles: number;
        validFiles: number;
        invalidFiles: number;
        warningFiles: number;
        importedFiles: number;
        skippedFiles: number;
    };
    files: TestCaseImportFileReport[];
}

interface TestCaseImportReviewDialogProps {
    isOpen: boolean;
    data: TestCaseImportReviewData | null;
    isProcessing: boolean;
    onProceed: () => void;
    onDiscard: () => void;
}

function formatIssueLabel(issue: TestCaseImportIssue): string {
    const sheetPart = issue.sheet ? `${issue.sheet}` : '';
    const rowPart = typeof issue.row === 'number' ? ` row ${issue.row}` : '';
    const prefix = sheetPart || rowPart ? `${sheetPart}${rowPart}: ` : '';
    return `${prefix}${issue.reason}`;
}

export default function TestCaseImportReviewDialog({
    isOpen,
    data,
    isProcessing,
    onProceed,
    onDiscard,
}: TestCaseImportReviewDialogProps) {
    const { t } = useI18n();
    const filesWithIssues = (data?.files || []).filter((file) => file.issues.length > 0);
    const hasErrorIssues = filesWithIssues.some((file) => file.issues.some((issue) => issue.severity === 'error'));
    const hasOverwriteWarning = filesWithIssues.some((file) => file.issues.some((issue) => issue.code === 'MATCHED_EXISTING_TEST_CASE'));
    const confirmText = hasOverwriteWarning
        ? (hasErrorIssues ? t('project.batchImport.dialog.overwriteValidRecords') : t('project.batchImport.dialog.overwriteAndImport'))
        : (hasErrorIssues ? t('project.batchImport.dialog.importValidOnly') : t('project.batchImport.dialog.continueImport'));
    const title = hasOverwriteWarning
        ? t('project.batchImport.dialog.titleOverwrite')
        : (hasErrorIssues ? t('project.batchImport.dialog.titleError') : t('project.batchImport.dialog.titleWarning'));

    return (
        <Modal
            isOpen={isOpen}
            onClose={onDiscard}
            title={title}
            onConfirm={onProceed}
            confirmText={confirmText}
            cancelText={t('project.batchImport.dialog.discard')}
            confirmDisabled={isProcessing}
            closeOnConfirm={false}
        >
            <div className="space-y-4 text-sm text-gray-700">
                {data && (
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                        {t('project.batchImport.dialog.summary', {
                            total: data.summary.totalFiles,
                            valid: data.summary.validFiles,
                            invalid: data.summary.invalidFiles,
                            warnings: data.summary.warningFiles,
                        })}
                    </div>
                )}

                <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                    {filesWithIssues.map((file) => (
                        <div key={file.filename} className="rounded-md border border-gray-200 p-3">
                            <div className="mb-2 break-all font-medium text-gray-900">{file.filename}</div>
                            <ul className="space-y-2">
                                {file.issues.map((issue, index) => (
                                    <li
                                        key={`${file.filename}-${issue.code}-${index}`}
                                        className={issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}
                                    >
                                        {formatIssueLabel(issue)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

'use client';

import Modal from '@/components/shared/Modal';
import Button from '@/components/shared/Button';
import { useI18n } from '@/i18n';

export interface TestCaseImportIssue {
    code: string;
    severity: 'info' | 'warning' | 'error';
    reason: string;
    sheet?: string;
    row?: number;
    filename: string;
}

export interface TestCaseImportFileReport {
    filename: string;
    status: 'complete' | 'incomplete' | 'invalid' | 'imported' | 'skipped';
    issues: TestCaseImportIssue[];
}

export interface TestCaseImportReviewData {
    summary: {
        totalFiles: number;
        completeFiles: number;
        incompleteFiles: number;
        invalidFiles: number;
        importedFiles: number;
        skippedFiles: number;
    };
    files: TestCaseImportFileReport[];
}

interface TestCaseImportReviewDialogProps {
    isOpen: boolean;
    data: TestCaseImportReviewData | null;
    isProcessing: boolean;
    onDiscard: () => void;
    onImportComplete: () => void;
    onImportAllDraft: () => void;
}

function formatIssueLabel(issue: TestCaseImportIssue): string {
    const sheetPart = issue.sheet ? `${issue.sheet}` : '';
    const rowPart = typeof issue.row === 'number' ? ` row ${issue.row}` : '';
    const prefix = sheetPart || rowPart ? `${sheetPart}${rowPart}: ` : '';
    return `${prefix}${issue.reason}`;
}

function issueColorClass(severity: TestCaseImportIssue['severity']): string {
    if (severity === 'error') return 'text-red-700';
    if (severity === 'warning') return 'text-amber-700';
    return 'text-gray-500';
}

export default function TestCaseImportReviewDialog({
    isOpen,
    data,
    isProcessing,
    onDiscard,
    onImportComplete,
    onImportAllDraft,
}: TestCaseImportReviewDialogProps) {
    const { t } = useI18n();
    const filesWithIssues = (data?.files || []).filter((file) => file.issues.length > 0);
    const completeCount = data?.summary.completeFiles ?? 0;
    const incompleteCount = data?.summary.incompleteFiles ?? 0;
    const invalidCount = data?.summary.invalidFiles ?? 0;

    const title = invalidCount > 0
        ? t('project.batchImport.dialog.titleError')
        : t('project.batchImport.dialog.titleWarning');

    return (
        <Modal
            isOpen={isOpen}
            onClose={onDiscard}
            title={title}
            showFooter={false}
        >
            <div className="space-y-4 text-sm text-gray-700">
                {data && (
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                        {t('project.batchImport.dialog.summary', {
                            total: data.summary.totalFiles,
                            complete: completeCount,
                            incomplete: incompleteCount,
                            invalid: invalidCount,
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
                                        className={issueColorClass(issue.severity)}
                                    >
                                        {formatIssueLabel(issue)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4">
                    <Button onClick={onDiscard} variant="secondary" size="sm" disabled={isProcessing}>
                        {t('project.batchImport.dialog.discard')}
                    </Button>
                    {incompleteCount > 0 && (
                        <Button onClick={onImportAllDraft} variant="secondary" size="sm" disabled={isProcessing}>
                            {t('project.batchImport.dialog.importAllDraft')}
                        </Button>
                    )}
                    {completeCount > 0 && (
                        <Button onClick={onImportComplete} variant="primary" size="sm" disabled={isProcessing}>
                            {t('project.batchImport.dialog.importCompleteOnly')}
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
}

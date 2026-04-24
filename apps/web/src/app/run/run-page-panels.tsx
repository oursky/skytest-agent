import { Suspense, type ChangeEvent, type ReactNode, type RefObject } from "react";
import { PageHeaderSkeleton, PanelSkeleton } from "@/components/shared";
import TestCaseImportReviewDialog, { type TestCaseImportReviewData } from "@/components/features/test-cases/ui/TestCaseImportReviewDialog";

interface RunPageHeaderProps {
    title: string;
    showStopButton: boolean;
    stopLabel: string;
    onStop: () => void;
}

export function RunPageHeader({ title, showStopButton, stopLabel, onStop }: RunPageHeaderProps) {
    return (
        <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-gray-900">
                {title}
            </h1>
            <div className="flex items-center gap-2">
                {showStopButton && (
                    <button
                        onClick={onStop}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors flex items-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                        {stopLabel}
                    </button>
                )}
            </div>
        </div>
    );
}

interface ActiveRunPanelProps {
    title: string;
    subtitle: string;
    viewLabel: string;
    onView: () => void;
}

export function ActiveRunPanel({ title, subtitle, viewLabel, onView }: ActiveRunPanelProps) {
    return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">{title}</h3>
            <p className="text-blue-700 mb-4">{subtitle}</p>
            <button
                onClick={onView}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
                {viewLabel}
            </button>
        </div>
    );
}

interface RunPageImportControlsProps {
    importReviewData: TestCaseImportReviewData | null;
    isProcessing: boolean;
    fileInputRef: RefObject<HTMLInputElement | null>;
    onProceed: () => void;
    onDiscard: () => void;
    onImport: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function RunPageImportControls({
    importReviewData,
    isProcessing,
    fileInputRef,
    onProceed,
    onDiscard,
    onImport,
}: RunPageImportControlsProps) {
    return (
        <>
            <TestCaseImportReviewDialog
                isOpen={importReviewData !== null}
                data={importReviewData}
                isProcessing={isProcessing}
                onProceed={onProceed}
                onDiscard={onDiscard}
            />

            <input
                type="file"
                ref={fileInputRef}
                onChange={onImport}
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
            />
        </>
    );
}

export function RunPageSkeleton() {
    return (
        <div className="max-w-7xl mx-auto">
            <PageHeaderSkeleton withAction={false} />
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 items-start">
                <PanelSkeleton className="min-h-[30rem] lg:min-h-[40rem]" lines={8} />
                <PanelSkeleton className="min-h-[30rem] lg:min-h-[40rem]" lines={8} />
            </div>
        </div>
    );
}

interface RunPageLayoutProps {
    children: ReactNode;
}

export function RunPageLayout({ children }: RunPageLayoutProps) {
    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <Suspense fallback={<RunPageSkeleton />}>
                    {children}
                </Suspense>
            </div>
        </main>
    );
}

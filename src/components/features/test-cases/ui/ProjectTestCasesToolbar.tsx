'use client';

import type { KeyboardEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/shared';

interface ProjectTestCasesToolbarProps {
    projectId: string;
    searchInput: string;
    onSearchInputChange: (value: string) => void;
    onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    onSearch: () => void;
    onOpenBatchImport: () => void;
    onExportSelected: () => void;
    isBatchImportProcessing: boolean;
    isExportingSelected: boolean;
    selectedCount: number;
    t: (key: string) => string;
}

function ActionIcon({ path }: { path: string }) {
    return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
        </svg>
    );
}

function SearchButton({ onSearch, ariaLabel, className }: { onSearch: () => void; ariaLabel: string; className: string }) {
    return (
        <button
            type="button"
            onClick={onSearch}
            className={className}
            aria-label={ariaLabel}
        >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
        </button>
    );
}

export default function ProjectTestCasesToolbar({
    projectId,
    searchInput,
    onSearchInputChange,
    onSearchKeyDown,
    onSearch,
    onOpenBatchImport,
    onExportSelected,
    isBatchImportProcessing,
    isExportingSelected,
    selectedCount,
    t,
}: ProjectTestCasesToolbarProps) {
    return (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="hidden items-center gap-2 sm:relative sm:flex">
                <input
                    type="text"
                    value={searchInput}
                    onChange={(event) => onSearchInputChange(event.target.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder={t('project.search.placeholder')}
                    className="w-64 rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <SearchButton
                    onSearch={onSearch}
                    ariaLabel={t('project.search.button')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 transition-colors hover:text-gray-600"
                />
            </div>

            <div className="hidden items-center gap-2 sm:flex">
                <Button
                    type="button"
                    onClick={onOpenBatchImport}
                    disabled={isBatchImportProcessing}
                    variant="secondary"
                    size="sm"
                    className="gap-2"
                    title={t('project.batchImport.button')}
                >
                    <ActionIcon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    <span className="hidden md:inline">{t('project.batchImport.button')}</span>
                </Button>

                <Button
                    type="button"
                    onClick={onExportSelected}
                    disabled={selectedCount === 0 || isExportingSelected}
                    variant="secondary"
                    size="sm"
                    className="gap-2"
                    title={t('project.exportSelected')}
                >
                    <ActionIcon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    <span className="hidden md:inline">{t('project.exportSelected')}</span>
                </Button>

                <Link
                    href={`/run?projectId=${projectId}`}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                    title={t('project.startNewRun')}
                >
                    <ActionIcon path="M12 4v16m8-8H4" />
                    <span className="hidden md:inline">{t('project.startNewRun')}</span>
                </Link>
            </div>

            <div className="flex flex-col gap-2 sm:hidden">
                <div className="relative">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(event) => onSearchInputChange(event.target.value)}
                        onKeyDown={onSearchKeyDown}
                        placeholder={t('project.search.placeholder')}
                        className="w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <SearchButton
                        onSearch={onSearch}
                        ariaLabel={t('project.search.button')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 transition-colors hover:text-gray-600"
                    />
                </div>

                <div className="flex gap-2">
                    <Button
                        type="button"
                        onClick={onOpenBatchImport}
                        disabled={isBatchImportProcessing}
                        variant="secondary"
                        size="sm"
                        className="flex-1 justify-center gap-2"
                    >
                        <ActionIcon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        {t('project.batchImport.button')}
                    </Button>
                    <Button
                        type="button"
                        onClick={onExportSelected}
                        disabled={selectedCount === 0 || isExportingSelected}
                        variant="secondary"
                        size="sm"
                        className="flex-1 justify-center gap-2"
                    >
                        <ActionIcon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        {t('project.exportSelected')}
                    </Button>
                    <Link
                        href={`/run?projectId=${projectId}`}
                        className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                    >
                        <ActionIcon path="M12 4v16m8-8H4" />
                        {t('project.startNewRun')}
                    </Link>
                </div>
            </div>
        </div>
    );
}

export type { ProjectTestCasesToolbarProps };

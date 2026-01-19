'use client';

import { TestStep, BrowserConfig, StepType, TestCaseFile } from '@/types';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useRef, useState } from 'react';
import BrowserConfigCard from './BrowserConfigCard';
import SortableStepItem from './SortableStepItem';
import FileUploadZone, { FileUploadZoneHandle } from './FileUploadZone';
import { config } from '@/config/app';
import FileList from './FileList';
import { useI18n } from '@/i18n';

interface BrowserEntry {
    id: string;
    config: BrowserConfig;
}

interface BuilderFormProps {
    browsers: BrowserEntry[];
    setBrowsers: (browsers: BrowserEntry[]) => void;
    steps: TestStep[];
    setSteps: (steps: TestStep[]) => void;
    showPasswordMap: Record<string, boolean>;
    setShowPasswordMap: (map: Record<string, boolean>) => void;
    readOnly?: boolean;
    testCaseId?: string;
    files?: TestCaseFile[];
    onFilesChange?: (testCaseId?: string, uploadedFiles?: TestCaseFile[]) => void | Promise<void>;
    onEnsureTestCase?: () => Promise<string>;
}

export default function BuilderForm({
    browsers,
    setBrowsers,
    steps,
    setSteps,
    showPasswordMap,
    setShowPasswordMap,
    readOnly,
    testCaseId,
    files,
    onFilesChange,
    onEnsureTestCase
}: BuilderFormProps) {
    const { t } = useI18n();

    const [activeId, setActiveId] = useState<string | null>(null);
    const uploadRef = useRef<FileUploadZoneHandle>(null);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragCancel = () => {
        setActiveId(null);
    };

    const handleAddBrowser = () => {
        const nextChar = String.fromCharCode('a'.charCodeAt(0) + browsers.length);
        const newId = `browser_${nextChar}`;
        const newBrowser: BrowserEntry = {
            id: newId,
            config: { url: '', username: '', password: '' }
        };
        setBrowsers([...browsers, newBrowser]);
    };

    const handleRemoveBrowser = (index: number) => {
        if (browsers.length <= 1) return;
        const browserId = browsers[index].id;
        const hasLinkedSteps = steps.some(step => step.target === browserId);
        if (hasLinkedSteps) {
            alert(t('builderForm.alert.cannotDeleteBrowser'));
            return;
        }
        const newBrowsers = [...browsers];
        newBrowsers.splice(index, 1);
        setBrowsers(newBrowsers);
    };

    const updateBrowser = (index: number, field: keyof BrowserConfig, value: string) => {
        const newBrowsers = [...browsers];
        newBrowsers[index].config = {
            ...newBrowsers[index].config,
            [field]: value
        };
        setBrowsers(newBrowsers);
    };

    const togglePasswordVisibility = (browserId: string) => {
        setShowPasswordMap({
            ...showPasswordMap,
            [browserId]: !showPasswordMap[browserId]
        });
    };

    const handleAddStep = (type: StepType = 'ai-action') => {
        const newStep: TestStep = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            target: browsers[0]?.id || 'browser_a',
            action: '',
            type
        };
        setSteps([...steps, newStep]);
    };

    const handleRemoveStep = (index: number) => {
        const newSteps = [...steps];
        newSteps.splice(index, 1);
        setSteps(newSteps);
    };

    const handleStepChange = (index: number, field: keyof TestStep, value: string) => {
        const newSteps = [...steps];
        if (field === 'action') {
            newSteps[index].action = value;
        } else if (field === 'target') {
            newSteps[index].target = value;
        } else if (field === 'id') {
            newSteps[index].id = value;
        }
        setSteps(newSteps);
    };

    const handleStepTypeChange = (index: number, type: StepType) => {
        const newSteps = [...steps];
        const step = newSteps[index];
        const currentType = step.type || 'ai-action';

        if (currentType !== type) {
            if (currentType === 'ai-action') {
                newSteps[index] = {
                    ...step,
                    type,
                    aiAction: step.action,
                    action: step.codeAction || ''
                };
            } else {
                newSteps[index] = {
                    ...step,
                    type,
                    codeAction: step.action,
                    action: step.aiAction || ''
                };
            }
        }
        setSteps(newSteps);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = steps.findIndex((item) => item.id === active.id);
            const newIndex = steps.findIndex((item) => item.id === over.id);
            setSteps(arrayMove(steps, oldIndex, newIndex));
        }
        requestAnimationFrame(() => {
            setActiveId(null);
        });
    };

    const activeStep = activeId ? steps.find(s => s.id === activeId) : null;

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <label className="block text-sm font-medium text-foreground">{t('builderForm.browserConfigs')}</label>
                </div>

                <div className="space-y-4">
                    {browsers.map((browser, index) => (
                        <BrowserConfigCard
                            key={browser.id}
                            browser={browser}
                            index={index}
                            browsersCount={browsers.length}
                            showPassword={showPasswordMap[browser.id] || false}
                            onUpdate={(field, value) => updateBrowser(index, field, value)}
                            onRemove={() => handleRemoveBrowser(index)}
                            onTogglePassword={() => togglePasswordVisibility(browser.id)}
                            readOnly={readOnly}
                        />
                    ))}
                </div>

                {!readOnly && (
                    <button
                        type="button"
                        onClick={handleAddBrowser}
                        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {t('builderForm.addBrowser')}
                    </button>
                )}
            </div>

            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <label className="block text-sm font-medium text-foreground">{t('builderForm.testFiles')}</label>
                    </div>
                    {!readOnly && onFilesChange && (
                        <button
                            type="button"
                            className="text-sm font-medium text-gray-500 hover:text-gray-700 px-1 py-0.5"
                            title={t('builderForm.addFiles')}
                            onClick={() => uploadRef.current?.open()}
                        >
                            {t('builderForm.upload')}
                        </button>
                    )}
                </div>

                {!readOnly && onFilesChange && (
                    <FileUploadZone
                        ref={uploadRef}
                        testCaseId={testCaseId}
                        onUploadComplete={(id, uploadedFiles) => onFilesChange(id, uploadedFiles)}
                        disabled={readOnly}
                        ensureTestCase={onEnsureTestCase}
                        compact
                    />
                )}

                {!readOnly && (!files || files.length === 0) && (
                    <div className="text-xs text-gray-500 space-y-1.5">
                        <p>{t('builderForm.noFilesHint.title')}</p>
                        <code className="block bg-gray-100 px-2 py-1.5 rounded text-[11px] font-mono text-gray-600">
                            await page.setInputFiles(&apos;input[type=file]&apos;, &apos;uploads/your-test-case-id/file.pdf&apos;);
                        </code>
                        <p className="text-gray-400">
                            {t('builderForm.noFilesHint.max', { mb: Math.floor(config.files.maxFileSize / 1024 / 1024) })}
                        </p>
                    </div>
                )}

                <div className="overflow-x-hidden">
                    {files && files.length > 0 && testCaseId && (
                        <FileList
                            files={files}
                            testCaseId={testCaseId}
                            onDelete={() => onFilesChange?.()}
                            readOnly={readOnly}
                        />
                    )}
                    {(!files || files.length === 0) && readOnly && (
                        <p className="text-sm text-gray-400 italic">{t('builderForm.noFilesUploaded')}</p>
                    )}
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <label className="block text-sm font-medium text-foreground">{t('builderForm.testSteps')}</label>
                </div>

                {!readOnly && (
                    <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 space-y-3">
                        <p className="text-[11px] text-gray-500 leading-snug">
                            {t('builderForm.variablesHint')}
                        </p>
                        <div>
                            <p className="font-medium text-gray-700">{t('builderForm.aiStep')}</p>
                            <code className="block bg-white border border-gray-200 px-2 py-1.5 rounded text-gray-600 whitespace-pre-wrap">{`Login with username ${config.test.security.credentialPlaceholders.username} and password ${config.test.security.credentialPlaceholders.password}.
Verify products page is loaded.`}</code>
                        </div>
                        <div>
                            <p className="font-medium text-gray-700">{t('builderForm.codeStep')}</p>
                            <code className="block bg-white border border-gray-200 px-2 py-1.5 rounded text-gray-600 whitespace-pre-wrap">{`await page.fill('#user-name', username);
await page.fill('#password', password);
await page.getByRole('button', { name: 'Login' }).click();
await expect(page.getByText(username, {exact: true })).toBeVisible();`}</code>
                        </div>
                    </div>
                )}

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragCancel={handleDragCancel}
                >
                    <SortableContext
                        items={steps.map(s => s.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="space-y-4">
                            {steps.length === 0 && (
                                <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                                    <p className="text-sm text-gray-500">{t('builderForm.noSteps')}</p>
                                    {!readOnly && <p className="text-xs text-gray-400 mt-1">{t('builderForm.noStepsHint')}</p>}
                                </div>
                            )}
                            {steps.map((step, index) => (
                                <SortableStepItem
                                    key={step.id}
                                    step={step}
                                    index={index}
                                    browsers={browsers}
                                    onRemove={() => handleRemoveStep(index)}
                                    onChange={(field, value) => handleStepChange(index, field, value)}
                                    onTypeChange={(type) => handleStepTypeChange(index, type)}
                                    mode="builder"
                                    readOnly={readOnly}
                                    isAnyDragging={activeId !== null}
                                />
                            ))}
                        </div>
                    </SortableContext>
                    <DragOverlay>
                        {activeStep ? (
                            <div className="p-4 bg-white rounded-xl border-2 border-indigo-300 shadow-lg opacity-95">
                                <div className="flex items-center gap-3">
                                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-xs font-mono text-indigo-600 font-bold">
                                        {steps.findIndex(s => s.id === activeStep.id) + 1}
                                    </span>
                                    <span className="text-sm text-gray-600 truncate max-w-[300px]">
                                        {activeStep.action || t('builderForm.emptyStep')}
                                    </span>
                                    <span className="ml-auto text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-500">
                                        {activeStep.type === 'playwright-code' ? t('builderForm.stepType.code') : t('builderForm.stepType.ai')}
                                    </span>
                                </div>
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>

                {!readOnly && (
                    <button
                        type="button"
                        onClick={() => handleAddStep('ai-action')}
                        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {t('builderForm.addStep')}
                    </button>
                )}
            </div>
        </div>
    );
}

export type { BrowserEntry, BuilderFormProps };

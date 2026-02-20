'use client';

import { TestStep, BrowserConfig, TargetConfig, StepType, ConfigItem, TestCaseFile } from '@/types';
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
import { useState } from 'react';
import SortableStepItem from './SortableStepItem';
import { useI18n } from '@/i18n';

interface BrowserEntry {
    id: string;
    config: BrowserConfig | TargetConfig;
}

interface BuilderFormProps {
    browsers: BrowserEntry[];
    steps: TestStep[];
    setSteps: (steps: TestStep[]) => void;
    readOnly?: boolean;
    projectConfigs?: ConfigItem[];
    testCaseConfigs?: ConfigItem[];
    testCaseFiles?: TestCaseFile[];
}

export default function BuilderForm({
    browsers,
    steps,
    setSteps,
    readOnly,
    projectConfigs,
    testCaseConfigs,
    testCaseFiles,
}: BuilderFormProps) {
    const { t } = useI18n();

    const [activeId, setActiveId] = useState<string | null>(null);

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

    const handleStepFilesChange = (index: number, fileIds: string[]) => {
        const newSteps = [...steps];
        const nextFileIds = fileIds.length > 0 ? fileIds : undefined;
        newSteps[index] = {
            ...newSteps[index],
            files: nextFileIds
        };
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
        <div className="space-y-4 animate-fade-in">
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
                                onFilesChange={(fileIds) => handleStepFilesChange(index, fileIds)}
                                onTypeChange={(type) => handleStepTypeChange(index, type)}
                                readOnly={readOnly}
                                isAnyDragging={activeId !== null}
                                projectConfigs={projectConfigs}
                                testCaseConfigs={testCaseConfigs}
                                testCaseFiles={testCaseFiles}
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
    );
}

export type { BrowserEntry, BuilderFormProps };

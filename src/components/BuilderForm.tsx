'use client';

import { TestStep, BrowserConfig } from '@/types';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import BrowserConfigCard from './BrowserConfigCard';
import SortableStepItem from './SortableStepItem';

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
}

export default function BuilderForm({
    browsers,
    setBrowsers,
    steps,
    setSteps,
    showPasswordMap,
    setShowPasswordMap,
    readOnly
}: BuilderFormProps) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

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

    const handleAddStep = () => {
        const newStep: TestStep = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            target: browsers[0]?.id || 'browser_a',
            action: ''
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

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            setSteps((() => {
                const oldIndex = steps.findIndex((item) => item.id === active.id);
                const newIndex = steps.findIndex((item) => item.id === over.id);
                return arrayMove(steps, oldIndex, newIndex);
            })());
        }
    };

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <label className="block text-sm font-medium text-foreground">Browser Configurations</label>
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
                        Add Another Browser
                    </button>
                )}
            </div>

            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <label className="block text-sm font-medium text-foreground">Test Steps</label>
                </div>

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={steps.map(s => s.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="space-y-4">
                            {steps.length === 0 && (
                                <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                                    <p className="text-sm text-gray-500">No steps defined yet.</p>
                                    {!readOnly && <p className="text-xs text-gray-400 mt-1">Click below to add a step.</p>}
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
                                    mode="builder"
                                    readOnly={readOnly}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>

                {!readOnly && (
                    <button
                        type="button"
                        onClick={handleAddStep}
                        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Step
                    </button>
                )}
            </div>
        </div>
    );
}

export type { BrowserEntry, BuilderFormProps };

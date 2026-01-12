'use client';

import { TestStep, StepType } from '@/types';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import dynamic from 'next/dynamic';
import { useState } from 'react';

const PlaywrightCodeEditor = dynamic(
    () => import('./PlaywrightCodeEditor'),
    {
        ssr: false,
        loading: () => (
            <div className="h-[180px] bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center text-gray-400 text-sm">
                Loading editor...
            </div>
        )
    }
);

interface BrowserEntry {
    id: string;
    config: {
        url: string;
        username?: string;
        password?: string;
    };
}

interface SortableStepItemProps {
    step: TestStep;
    index: number;
    browsers: BrowserEntry[];
    onRemove: () => void;
    onChange: (field: keyof TestStep, value: string) => void;
    onTypeChange?: (type: StepType) => void;
    mode: 'simple' | 'builder';
    readOnly?: boolean;
    isAnyDragging?: boolean;
}

export default function SortableStepItem({ step, index, browsers, onRemove, onChange, onTypeChange, mode, readOnly, isAnyDragging }: SortableStepItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: step.id, disabled: readOnly });

    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const stepType = step.type || 'ai-action';

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 1,
        opacity: isDragging ? 0.5 : 1,
    };

    const hideMonacoEditor = isAnyDragging && stepType === 'playwright-code';

    const browserIndex = browsers.findIndex(b => b.id === step.target);
    const safeIndex = browserIndex >= 0 ? browserIndex : 0;
    const colorsLight = ['bg-blue-50', 'bg-purple-50', 'bg-orange-50', 'bg-green-50', 'bg-pink-50'];
    const colorsText = ['text-blue-700', 'text-purple-700', 'text-orange-700', 'text-green-700', 'text-pink-700'];
    const colorsBorder = ['border-blue-200', 'border-purple-200', 'border-orange-200', 'border-green-200', 'border-pink-200'];

    const colorLight = colorsLight[safeIndex % colorsLight.length];
    const colorText = colorsText[safeIndex % colorsText.length];
    const colorBorder = colorsBorder[safeIndex % colorsBorder.length];

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="group relative p-4 bg-white rounded-xl border border-gray-200 shadow-sm hover:border-indigo-200 hover:shadow-md transition-all"
        >
            <div className="flex items-center gap-3 mb-3">
                {/* Drag Handle */}
                {!readOnly && (
                    <div
                        {...attributes}
                        {...listeners}
                        className="cursor-move p-1 text-gray-300 hover:text-gray-500 hover:bg-gray-100 rounded"
                        aria-label="Drag step"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </div>
                )}

                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-mono text-gray-500 font-bold">
                    {index + 1}
                </span>

                {/* Browser Select */}
                <div className="relative">
                    <select
                        value={step.target}
                        onChange={(e) => onChange('target', e.target.value)}
                        disabled={readOnly}
                        className={`text-xs font-bold uppercase tracking-wider pl-3 pr-8 py-1.5 rounded-md border appearance-none ${readOnly ? 'cursor-not-allowed opacity-80' : 'cursor-pointer focus:ring-2 focus:ring-offset-1'} ${colorLight} ${colorText} ${colorBorder}`}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        {browsers.map(b => (
                            <option key={b.id} value={b.id}>
                                {b.id.startsWith('browser_')
                                    ? b.id.replace('browser_', 'Browser ').toUpperCase()
                                    : b.id}
                            </option>
                        ))}
                    </select>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                        <svg className={`w-3 h-3 ${colorText}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>

                {/* Step Type Toggle */}
                {!readOnly && onTypeChange && (
                    <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-md ml-auto mr-2">
                        <button
                            type="button"
                            onClick={() => onTypeChange('ai-action')}
                            onPointerDown={(e) => e.stopPropagation()}
                            className={`px-2 py-1 text-xs font-medium rounded transition-all ${stepType === 'ai-action'
                                ? 'bg-white text-indigo-600 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                            title="AI Action - Natural language instruction"
                        >
                            AI
                        </button>
                        <button
                            type="button"
                            onClick={() => onTypeChange('playwright-code')}
                            onPointerDown={(e) => e.stopPropagation()}
                            className={`px-2 py-1 text-xs font-medium rounded transition-all ${stepType === 'playwright-code'
                                ? 'bg-white text-orange-600 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                            title="Playwright Code - Custom JavaScript"
                        >
                            Code
                        </button>
                    </div>
                )}

                {!readOnly && (
                    <button
                        type="button"
                        onClick={onRemove}
                        className={`${onTypeChange ? '' : 'ml-auto'} text-gray-300 hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors`}
                        aria-label="Remove step"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    {stepType === 'ai-action' ? 'Action Instructions' : 'Playwright Code'}
                </label>

                {stepType === 'ai-action' ? (
                    <textarea
                        value={step.action}
                        onChange={(e) => {
                            onChange('action', e.target.value);
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Describe the action to perform..."
                        className="w-full text-sm border-gray-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 min-h-[80px] py-3 px-3 resize-none bg-gray-50 focus:bg-white transition-colors disabled:bg-gray-100 disabled:text-gray-600"
                        required={mode === 'builder'}
                        rows={3}
                        disabled={readOnly}
                    />
                ) : hideMonacoEditor ? (
                    <div className="h-[180px] bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center text-gray-400 text-sm">
                        <code className="text-xs text-gray-500 truncate max-w-full px-4">{step.action || 'Code editor'}</code>
                    </div>
                ) : (
                    <div onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <PlaywrightCodeEditor
                            value={step.action}
                            onChange={(value) => onChange('action', value)}
                            readOnly={readOnly}
                            onValidationChange={(isValid, errors) => setValidationErrors(errors)}
                        />
                        {validationErrors.length > 0 && (
                            <div className="text-xs text-red-500 mt-1 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                {validationErrors[0]}
                            </div>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                            Example: <code className="bg-gray-100 px-1 rounded text-gray-600">await page.locator('[data-test="login-button"]').click();</code>
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export type { BrowserEntry, SortableStepItemProps };

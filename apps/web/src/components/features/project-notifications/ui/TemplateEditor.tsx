'use client';

import { useRef } from 'react';

interface TemplateEditorProps {
    title: string;
    resetLabel: string;
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
    onReset: () => void;
    variables?: string[];
}

const TEST_CASE_TEMPLATE_VARIABLES = [
    'projectName',
    'testCaseID',
    'testCaseName',
    'testRunLink',
    'triggeredBy',
    'startedAt',
    'completedAt',
    'durationMinSec',
    'errorSummary',
];

export const TEST_GROUP_TEMPLATE_VARIABLES = [
    'projectName',
    'groupName',
    'passedCount',
    'totalCount',
    'runLink',
    'triggeredBy',
    'startedAt',
    'completedAt',
];

export default function TemplateEditor({
    title,
    resetLabel,
    value,
    disabled,
    onChange,
    onReset,
    variables = TEST_CASE_TEMPLATE_VARIABLES,
}: TemplateEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const insertAtCursor = (text: string) => {
        const textarea = textareaRef.current;
        if (!textarea) {
            onChange(`${value}${text}`);
            return;
        }

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
        onChange(nextValue);

        queueMicrotask(() => {
            textarea.focus();
            const position = start + text.length;
            textarea.setSelectionRange(position, position);
        });
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">
                    {title}
                </label>
                <button
                    type="button"
                    onClick={onReset}
                    disabled={disabled}
                    className="text-xs text-primary hover:underline disabled:opacity-50"
                >
                    {resetLabel}
                </button>
            </div>

            <textarea
                ref={textareaRef}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                rows={8}
                className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50"
            />

            <div className="flex flex-wrap gap-2">
                {variables.map((variable) => (
                    <button
                        key={variable}
                        type="button"
                        disabled={disabled}
                        onClick={() => insertAtCursor(`{${variable}}`)}
                        className="rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        {`{${variable}}`}
                    </button>
                ))}
            </div>

        </div>
    );
}

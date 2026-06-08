'use client';

import { useEffect, useRef, useState } from 'react';

interface MultiSelectOption {
    value: number;
    label: string;
}

interface MultiSelectMenuProps {
    options: MultiSelectOption[];
    selected: number[];
    disabled?: boolean;
    placeholder: string;
    columns?: number;
    onChange: (next: number[]) => void;
}

export default function MultiSelectMenu({
    options,
    selected,
    disabled = false,
    placeholder,
    columns = 7,
    onChange,
}: MultiSelectMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const handlePointerDown = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [isOpen]);

    const selectedSet = new Set(selected);
    const summary = options
        .filter((option) => selectedSet.has(option.value))
        .map((option) => option.label)
        .join(', ');

    const toggle = (value: number) => {
        onChange(selectedSet.has(value)
            ? selected.filter((item) => item !== value)
            : [...selected, value]);
    };

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setIsOpen((open) => !open)}
                className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-gray-300 px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
                <span className={`truncate ${summary ? 'text-gray-900' : 'text-gray-400'}`}>{summary || placeholder}</span>
                <svg className="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {isOpen && (
                <div className="absolute z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                        {options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => toggle(option.value)}
                                className={`rounded px-1 py-1 text-center text-xs transition-colors ${selectedSet.has(option.value) ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

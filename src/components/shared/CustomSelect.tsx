'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type SelectValue = string | number;

interface SelectOption<T extends SelectValue> {
    value: T;
    label: string;
    disabled?: boolean;
}

interface CustomSelectProps<T extends SelectValue> {
    value: T;
    options: SelectOption<T>[];
    onChange: (value: T) => void;
    ariaLabel?: string;
    ariaLabelledBy?: string;
    buttonClassName?: string;
    menuClassName?: string;
    optionClassName?: string;
    disabled?: boolean;
    fullWidth?: boolean;
    footerActionLabel?: string;
    onFooterAction?: () => void;
    footerActionClassName?: string;
}

const findEnabledIndex = <T extends SelectValue>(
    options: SelectOption<T>[],
    startIndex: number,
    direction: 1 | -1
) => {
    let index = startIndex;

    while (index >= 0 && index < options.length) {
        if (!options[index]?.disabled) {
            return index;
        }
        index += direction;
    }

    return -1;
};

export default function CustomSelect<T extends SelectValue>({
    value,
    options,
    onChange,
    ariaLabel,
    ariaLabelledBy,
    buttonClassName = '',
    menuClassName = '',
    optionClassName = '',
    disabled = false,
    fullWidth = false,
    footerActionLabel,
    onFooterAction,
    footerActionClassName = '',
}: CustomSelectProps<T>) {
    const listboxId = useId();
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number } | null>(null);

    const selectedIndex = useMemo(
        () => options.findIndex((option) => option.value === value),
        [options, value]
    );
    const [focusIndex, setFocusIndex] = useState(Math.max(selectedIndex, 0));

    const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

    const openMenu = () => {
        const nextIndex = findEnabledIndex(options, Math.max(selectedIndex, 0), 1);
        setFocusIndex(nextIndex >= 0 ? nextIndex : 0);
        setIsOpen(true);
    };

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const updateMenuPosition = () => {
            const button = buttonRef.current;
            if (!button) {
                return;
            }

            const rect = button.getBoundingClientRect();
            setMenuStyle({
                top: rect.bottom + 8,
                left: rect.left,
                width: rect.width,
            });
        };

        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        window.addEventListener('scroll', updateMenuPosition, true);

        const rafId = window.requestAnimationFrame(() => {
            optionRefs.current[focusIndex]?.focus();
        });

        return () => {
            window.cancelAnimationFrame(rafId);
            window.removeEventListener('resize', updateMenuPosition);
            window.removeEventListener('scroll', updateMenuPosition, true);
        };
    }, [focusIndex, isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) {
                return;
            }
            setIsOpen(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
                buttonRef.current?.focus();
                return;
            }

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setFocusIndex((current) => {
                    const nextIndex = findEnabledIndex(options, current + 1, 1);
                    return nextIndex >= 0 ? nextIndex : current;
                });
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setFocusIndex((current) => {
                    const nextIndex = findEnabledIndex(options, current - 1, -1);
                    return nextIndex >= 0 ? nextIndex : current;
                });
                return;
            }

            if (event.key === 'Home') {
                event.preventDefault();
                const nextIndex = findEnabledIndex(options, 0, 1);
                if (nextIndex >= 0) {
                    setFocusIndex(nextIndex);
                }
                return;
            }

            if (event.key === 'End') {
                event.preventDefault();
                const nextIndex = findEnabledIndex(options, options.length - 1, -1);
                if (nextIndex >= 0) {
                    setFocusIndex(nextIndex);
                }
                return;
            }

            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                const option = options[focusIndex];
                if (option && !option.disabled) {
                    onChange(option.value);
                }
                setIsOpen(false);
                buttonRef.current?.focus();
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [focusIndex, isOpen, onChange, options]);

    const menu = isOpen && menuStyle ? createPortal(
        <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            style={{
                top: menuStyle.top,
                left: menuStyle.left,
                width: menuStyle.width,
            }}
            className={`fixed z-[70] max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg ${fullWidth ? 'w-full' : 'min-w-full'} ${menuClassName}`.trim()}
        >
            {options.map((option, index) => (
                <button
                    key={String(option.value)}
                    ref={(element) => {
                        optionRefs.current[index] = element;
                    }}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    disabled={option.disabled}
                    onMouseEnter={() => {
                        if (!option.disabled) {
                            setFocusIndex(index);
                        }
                    }}
                    onClick={() => {
                        if (option.disabled) {
                            return;
                        }
                        onChange(option.value);
                        setIsOpen(false);
                        buttonRef.current?.focus();
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${option.value === value ? 'font-semibold text-primary' : 'text-gray-700'} ${optionClassName}`.trim()}
                >
                    <span className="truncate">{option.label}</span>
                    {option.value === value && (
                        <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    )}
                </button>
            ))}
            {footerActionLabel && onFooterAction && (
                <div className="border-t border-gray-100 px-1 pt-1">
                    <button
                        type="button"
                        onClick={() => {
                            setIsOpen(false);
                            onFooterAction();
                            buttonRef.current?.focus();
                        }}
                        className={`flex w-full items-center px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${footerActionClassName}`.trim()}
                    >
                        {footerActionLabel}
                    </button>
                </div>
            )}
        </div>,
        document.body
    ) : null;

    return (
        <div className={`relative ${fullWidth ? 'w-full' : ''}`}>
            <button
                ref={buttonRef}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-controls={listboxId}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                disabled={disabled}
                onClick={() => {
                    if (disabled) {
                        return;
                    }
                    if (isOpen) {
                        setIsOpen(false);
                        return;
                    }
                    openMenu();
                }}
                onKeyDown={(event) => {
                    if (disabled) {
                        return;
                    }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openMenu();
                    }
                }}
                className={`inline-flex items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50 ${fullWidth ? 'w-full' : ''} ${buttonClassName}`.trim()}
            >
                <span className="truncate">{selectedOption?.label ?? ''}</span>
                <svg
                    className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {menu}
        </div>
    );
}

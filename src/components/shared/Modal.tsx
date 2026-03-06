'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/i18n';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    onConfirm?: () => void;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: 'primary' | 'danger';
    closeOnConfirm?: boolean;
    confirmDisabled?: boolean;
    showFooter?: boolean;
    overlayClassName?: string;
    panelClassName?: string;
    contentClassName?: string;
}

export default function Modal({
    isOpen,
    onClose,
    title,
    children,
    onConfirm,
    confirmText,
    cancelText,
    confirmVariant = 'primary',
    closeOnConfirm = true,
    confirmDisabled = false,
    showFooter = true,
    overlayClassName = '',
    panelClassName = '',
    contentClassName = '',
}: ModalProps) {
    const { t } = useI18n();
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    const effectiveCancelText = cancelText ?? t('common.cancel');
    const effectiveConfirmText = confirmText ?? t('common.confirm');

    if (!isOpen) return null;

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in ${overlayClassName}`}
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                ref={modalRef}
                className={`flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-xl ${panelClassName}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 id="modal-title" className="text-xl font-semibold text-gray-900">
                        {title}
                    </h2>
                </div>

                {/* Content */}
                <div className={`flex-1 overflow-y-auto px-6 py-4 ${contentClassName}`}>
                    {children}
                </div>

                {showFooter && (
                    <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                        >
                            {effectiveCancelText}
                        </button>
                        {onConfirm && (
                            <button
                                onClick={() => {
                                    if (confirmDisabled) {
                                        return;
                                    }
                                    onConfirm();
                                    if (closeOnConfirm) {
                                        onClose();
                                    }
                                }}
                                disabled={confirmDisabled}
                                className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                                    confirmVariant === 'danger'
                                        ? 'bg-red-600 hover:bg-red-700'
                                        : 'bg-primary hover:bg-primary/90'
                                } disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                                {effectiveConfirmText}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

'use client';

import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n';
import Button from './Button';

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
    const shouldHandleEnterToConfirm = isOpen && showFooter && !!onConfirm && confirmVariant === 'primary';

    const handleConfirm = useCallback(() => {
        if (!onConfirm || confirmDisabled) {
            return;
        }

        onConfirm();
        if (closeOnConfirm) {
            onClose();
        }
    }, [closeOnConfirm, confirmDisabled, onClose, onConfirm]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isOpen]);

    useEffect(() => {
        const handleEnterToConfirm = (e: KeyboardEvent) => {
            if (
                e.key === 'Enter'
                && !e.defaultPrevented
                && !e.isComposing
                && e.target instanceof HTMLInputElement
            ) {
                e.preventDefault();
                handleConfirm();
            }
        };

        if (shouldHandleEnterToConfirm) {
            document.addEventListener('keydown', handleEnterToConfirm);
        }

        return () => {
            document.removeEventListener('keydown', handleEnterToConfirm);
        };
    }, [handleConfirm, shouldHandleEnterToConfirm]);

    const effectiveCancelText = cancelText ?? t('common.cancel');
    const effectiveConfirmText = confirmText ?? t('common.confirm');

    if (!isOpen) return null;

    return createPortal(
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in ${overlayClassName}`}
        >
            <div
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
                        <Button
                            onClick={onClose}
                            variant="secondary"
                            size="sm"
                        >
                            {effectiveCancelText}
                        </Button>
                        {onConfirm && (
                            <Button
                                onClick={handleConfirm}
                                disabled={confirmDisabled}
                                variant={confirmVariant === 'danger' ? 'danger' : 'primary'}
                                size="sm"
                            >
                                {effectiveConfirmText}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}

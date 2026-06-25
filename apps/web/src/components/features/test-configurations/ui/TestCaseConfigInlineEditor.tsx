import type { KeyboardEvent, ReactNode } from 'react';
import type { ConfigType } from '@/types';
import { useI18n } from '@/i18n';
import ConfigInlineEditorForm from './ConfigInlineEditorForm';
import type { EditState } from '../model/config-types';

interface TestCaseConfigInlineEditorProps {
    type: ConfigType;
    editState: EditState;
    error: string | null;
    autoFocus?: boolean;
    onChange: (next: EditState) => void;
    onSave: () => void;
    onCancel: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
    renderRandomStringControl: (value: string) => ReactNode;
}

export default function TestCaseConfigInlineEditor({
    type,
    editState,
    error,
    autoFocus,
    onChange,
    onSave,
    onCancel,
    onKeyDown,
    renderRandomStringControl,
}: TestCaseConfigInlineEditorProps) {
    const { t } = useI18n();

    return (
        <ConfigInlineEditorForm
            type={type}
            editState={editState}
            error={error}
            autoFocus={autoFocus}
            variant="compact"
            onChange={onChange}
            onSave={onSave}
            onCancel={onCancel}
            onKeyDown={onKeyDown}
            renderRandomStringControl={renderRandomStringControl}
            t={t}
        />
    );
}

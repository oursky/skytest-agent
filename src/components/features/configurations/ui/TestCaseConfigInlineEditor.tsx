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
    groupOptions: string[];
    onChange: (next: EditState) => void;
    onSave: () => void;
    onCancel: () => void;
    onRemoveGroup: (group: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
    renderRandomStringControl: (value: string) => ReactNode;
}

export default function TestCaseConfigInlineEditor({
    type,
    editState,
    error,
    autoFocus,
    groupOptions,
    onChange,
    onSave,
    onCancel,
    onRemoveGroup,
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
            groupOptions={groupOptions}
            variant="compact"
            onChange={onChange}
            onSave={onSave}
            onCancel={onCancel}
            onRemoveGroup={onRemoveGroup}
            onKeyDown={onKeyDown}
            renderRandomStringControl={renderRandomStringControl}
            t={t}
        />
    );
}

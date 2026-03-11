import type { KeyboardEvent } from 'react';
import type { ConfigType } from '@/types';
import { useI18n } from '@/i18n';
import ConfigInlineEditorForm from '@/components/features/test-configurations/ui/ConfigInlineEditorForm';
import type { ProjectConfigEditState } from '../model/types';

interface ConfigInlineEditorProps {
    type: ConfigType;
    editState: ProjectConfigEditState;
    groupOptions: string[];
    error: string | null;
    autoFocus?: boolean;
    rowAlign?: 'items-start' | 'items-center';
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
    onSave: () => void;
    onCancel: () => void;
    onRemoveGroup: (group: string) => void;
    onChange: (next: ProjectConfigEditState) => void;
}

export default function ConfigInlineEditor({
    type,
    editState,
    groupOptions,
    error,
    autoFocus,
    rowAlign = 'items-start',
    onKeyDown,
    onSave,
    onCancel,
    onRemoveGroup,
    onChange,
}: ConfigInlineEditorProps) {
    const { t } = useI18n();

    return (
        <ConfigInlineEditorForm
            type={type}
            editState={editState}
            error={error}
            autoFocus={autoFocus}
            groupOptions={groupOptions}
            variant="regular"
            rowAlign={rowAlign}
            onChange={onChange}
            onSave={onSave}
            onCancel={onCancel}
            onRemoveGroup={onRemoveGroup}
            onKeyDown={onKeyDown}
            t={t}
        />
    );
}

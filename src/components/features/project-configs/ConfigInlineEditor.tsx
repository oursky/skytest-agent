import type { KeyboardEvent } from 'react';
import type { ConfigType } from '@/types';
import { isGroupableConfigType } from '@/lib/config/sort';
import { useI18n } from '@/i18n';
import GroupSelectInput from '@/components/ui/GroupSelectInput';
import MaskedIcon from '@/components/features/configurations/shared/MaskedIcon';
import type { ProjectConfigEditState } from './types';

interface ConfigInlineEditorProps {
    type: ConfigType;
    editState: ProjectConfigEditState;
    groupOptions: string[];
    error: string | null;
    autoFocus?: boolean;
    rowAlign?: 'items-start' | 'items-center';
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
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

    if (type === 'VARIABLE') {
        return (
            <div className="p-4 bg-white space-y-2">
                <div className="flex flex-wrap md:flex-nowrap items-center gap-2">
                    <GroupSelectInput
                        value={editState.group}
                        onChange={(group) => onChange({ ...editState, group })}
                        options={groupOptions}
                        onRemoveOption={onRemoveGroup}
                        placeholder={t('configs.group.select')}
                        containerClassName="relative w-full md:w-56"
                        inputClassName="h-9 text-sm"
                    />
                    <input
                        type="text"
                        value={editState.name}
                        onChange={(event) => onChange({ ...editState, name: event.target.value })}
                        onKeyDown={onKeyDown}
                        placeholder={t('configs.name.placeholder.enter')}
                        className="h-9 w-full md:w-56 px-3 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        autoFocus={autoFocus}
                    />
                    <input
                        type={editState.masked ? 'password' : 'text'}
                        value={editState.value}
                        onChange={(event) => onChange({ ...editState, value: event.target.value })}
                        onKeyDown={onKeyDown}
                        placeholder={t('configs.value.placeholder')}
                        className="h-9 min-w-[220px] flex-1 px-3 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    <button
                        type="button"
                        onClick={() => onChange({ ...editState, masked: !editState.masked })}
                        className={`inline-flex h-9 w-9 items-center justify-center rounded-md border ${editState.masked ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-gray-600 border-gray-200'}`}
                        title={t('configs.masked')}
                        aria-label={t('configs.masked')}
                    >
                        <MaskedIcon masked={editState.masked} />
                    </button>
                    <button type="button" onClick={onSave} className="px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90">{t('common.save')}</button>
                    <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
        );
    }

    return (
        <div className="p-4 bg-white space-y-2">
            <div className={`flex gap-3 ${rowAlign}`}>
                <input
                    type="text"
                    value={editState.name}
                    onChange={(event) => onChange({ ...editState, name: event.target.value })}
                    onKeyDown={onKeyDown}
                    placeholder={t('configs.name.placeholder.enter')}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    autoFocus={autoFocus}
                />
                <input
                    type="text"
                    value={editState.value}
                    onChange={(event) => onChange({ ...editState, value: event.target.value })}
                    onKeyDown={onKeyDown}
                    placeholder={type === 'URL' ? t('configs.url.placeholder') : t('configs.value.placeholder')}
                    className="flex-[2] px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
                <button type="button" onClick={onSave} className="px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90">{t('common.save')}</button>
                <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
            </div>
            {isGroupableConfigType(type) && (
                <GroupSelectInput
                    value={editState.group}
                    onChange={(group) => onChange({ ...editState, group })}
                    options={groupOptions}
                    onRemoveOption={onRemoveGroup}
                    placeholder={t('configs.group.select')}
                    inputClassName="h-9"
                />
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}

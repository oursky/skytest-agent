import type { KeyboardEvent, ReactNode } from 'react';
import type { ConfigType } from '@/types';
import { isGroupableConfigType } from '@/lib/config/sort';
import { useI18n } from '@/i18n';
import GroupSelectInput from '@/components/GroupSelectInput';
import MaskedIcon from '@/components/config-shared/MaskedIcon';
import type { EditState } from './config-types';

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
        <div className="p-2 bg-blue-50/50 rounded">
            {type === 'VARIABLE' ? (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <GroupSelectInput
                            value={editState.group}
                            onChange={(group) => onChange({ ...editState, group })}
                            options={groupOptions}
                            onRemoveOption={onRemoveGroup}
                            placeholder={t('configs.group.select')}
                            inputClassName="h-8"
                        />
                        <input
                            type="text"
                            value={editState.name}
                            onChange={(e) => onChange({ ...editState, name: e.target.value })}
                            onKeyDown={onKeyDown}
                            placeholder={t('configs.name.placeholder.enter')}
                            className="h-8 w-full px-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                            autoFocus={autoFocus}
                        />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                            type={editState.masked ? 'password' : 'text'}
                            value={editState.value}
                            onChange={(e) => onChange({ ...editState, value: e.target.value })}
                            onKeyDown={onKeyDown}
                            placeholder={t('configs.value.placeholder')}
                            className="h-8 min-w-[220px] flex-1 px-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                            type="button"
                            onClick={() => onChange({ ...editState, masked: !editState.masked })}
                            className={`inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border ${editState.masked ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-gray-600 border-gray-200'}`}
                            title={t('configs.masked')}
                            aria-label={t('configs.masked')}
                        >
                            <MaskedIcon masked={editState.masked} />
                        </button>
                        <button type="button" onClick={onSave} className="px-2 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90">{t('common.save')}</button>
                        <button type="button" onClick={onCancel} className="px-2 py-1.5 text-xs text-gray-500">{t('common.cancel')}</button>
                    </div>
                </>
            ) : (
                <>
                    <div className={`flex gap-2 ${autoFocus ? 'items-center' : 'items-start'}`}>
                        <input
                            type="text"
                            value={editState.name}
                            onChange={(e) => onChange({ ...editState, name: e.target.value })}
                            onKeyDown={onKeyDown}
                            placeholder={t('configs.name.placeholder.enter')}
                            className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                            autoFocus={autoFocus}
                        />
                        <div className="flex-[2] relative">
                            {type === 'RANDOM_STRING' ? (
                                renderRandomStringControl(editState.value)
                            ) : (
                                <input
                                    type="text"
                                    value={editState.value}
                                    onChange={(e) => onChange({ ...editState, value: e.target.value })}
                                    onKeyDown={onKeyDown}
                                    placeholder={type === 'URL' ? t('configs.url.placeholder') : t('configs.value.placeholder')}
                                    className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            )}
                        </div>
                        <button type="button" onClick={onSave} className="px-2 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90">{t('common.save')}</button>
                        <button type="button" onClick={onCancel} className="px-2 py-1.5 text-xs text-gray-500">{t('common.cancel')}</button>
                    </div>
                    {isGroupableConfigType(type) && (
                        <div className="mt-2">
                            <GroupSelectInput
                                value={editState.group}
                                onChange={(group) => onChange({ ...editState, group })}
                                options={groupOptions}
                                onRemoveOption={onRemoveGroup}
                                placeholder={t('configs.group.select')}
                                inputClassName="h-8"
                            />
                        </div>
                    )}
                </>
            )}
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
    );
}

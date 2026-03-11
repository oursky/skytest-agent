import type { KeyboardEvent, ReactNode } from 'react';
import type { ConfigType } from '@/types';
import { isGroupableConfigType } from '@/lib/test-config/sort';
import { Button } from '@/components/shared';
import GroupSelectInput from './GroupSelectInput';
import MaskedIcon from './MaskedIcon';

interface ConfigInlineEditorState {
    type: ConfigType;
    name: string;
    value: string;
    masked: boolean;
    group: string;
}

type ConfigInlineEditorVariant = 'regular' | 'compact';
type ConfigInlineEditorRowAlign = 'items-start' | 'items-center';

interface ConfigInlineEditorFormProps {
    type: ConfigType;
    editState: ConfigInlineEditorState;
    error: string | null;
    autoFocus?: boolean;
    groupOptions: string[];
    variant: ConfigInlineEditorVariant;
    rowAlign?: ConfigInlineEditorRowAlign;
    onChange: (next: ConfigInlineEditorState) => void;
    onSave: () => void;
    onCancel: () => void;
    onRemoveGroup: (group: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
    renderRandomStringControl?: (value: string) => ReactNode;
    t: (key: string) => string;
}

function renderActionButtons(
    variant: ConfigInlineEditorVariant,
    onSave: () => void,
    onCancel: () => void,
    t: (key: string) => string
) {
    if (variant === 'compact') {
        return (
            <>
                <Button type="button" onClick={onSave} variant="primary" size="xs">
                    {t('common.save')}
                </Button>
                <Button type="button" onClick={onCancel} variant="ghost" size="xs" className="text-gray-500 hover:bg-transparent">
                    {t('common.cancel')}
                </Button>
            </>
        );
    }

    return (
        <>
            <Button type="button" onClick={onSave} variant="primary" size="sm">
                {t('common.save')}
            </Button>
            <Button type="button" onClick={onCancel} variant="ghost" size="sm" className="text-gray-500 hover:bg-transparent hover:text-gray-700">
                {t('common.cancel')}
            </Button>
        </>
    );
}

export default function ConfigInlineEditorForm({
    type,
    editState,
    error,
    autoFocus,
    groupOptions,
    variant,
    rowAlign = 'items-start',
    onChange,
    onSave,
    onCancel,
    onRemoveGroup,
    onKeyDown,
    renderRandomStringControl,
    t,
}: ConfigInlineEditorFormProps) {
    if (variant === 'compact') {
        return (
            <div className="rounded bg-blue-50/50 p-2">
                {type === 'VARIABLE' ? (
                    <>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
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
                                onChange={(event) => onChange({ ...editState, name: event.target.value })}
                                onKeyDown={onKeyDown}
                                placeholder={t('configs.name.placeholder.enter')}
                                className="h-8 w-full rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                autoFocus={autoFocus}
                            />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input
                                type={editState.masked ? 'password' : 'text'}
                                value={editState.value}
                                onChange={(event) => onChange({ ...editState, value: event.target.value })}
                                onKeyDown={onKeyDown}
                                placeholder={t('configs.value.placeholder')}
                                className="h-8 min-w-[220px] flex-1 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <button
                                type="button"
                                onClick={() => onChange({ ...editState, masked: !editState.masked })}
                                className={`inline-flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs ${editState.masked ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-600'}`}
                                title={t('configs.masked')}
                                aria-label={t('configs.masked')}
                            >
                                <MaskedIcon masked={editState.masked} />
                            </button>
                            {renderActionButtons(variant, onSave, onCancel, t)}
                        </div>
                    </>
                ) : (
                    <>
                        <div className={`flex gap-2 ${autoFocus ? 'items-center' : 'items-start'}`}>
                            <input
                                type="text"
                                value={editState.name}
                                onChange={(event) => onChange({ ...editState, name: event.target.value })}
                                onKeyDown={onKeyDown}
                                placeholder={t('configs.name.placeholder.enter')}
                                className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                autoFocus={autoFocus}
                            />
                            <div className="relative flex-[2]">
                                {type === 'RANDOM_STRING' && renderRandomStringControl
                                    ? renderRandomStringControl(editState.value)
                                    : (
                                        <input
                                            type="text"
                                            value={editState.value}
                                            onChange={(event) => onChange({ ...editState, value: event.target.value })}
                                            onKeyDown={onKeyDown}
                                            placeholder={type === 'URL' ? t('configs.url.placeholder') : t('configs.value.placeholder')}
                                            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                    )}
                            </div>
                            {renderActionButtons(variant, onSave, onCancel, t)}
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
                {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
            </div>
        );
    }

    return (
        <div className="space-y-2 bg-white p-4">
            {type === 'VARIABLE' ? (
                <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
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
                        className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary md:w-56"
                        autoFocus={autoFocus}
                    />
                    <input
                        type={editState.masked ? 'password' : 'text'}
                        value={editState.value}
                        onChange={(event) => onChange({ ...editState, value: event.target.value })}
                        onKeyDown={onKeyDown}
                        placeholder={t('configs.value.placeholder')}
                        className="h-9 min-w-[220px] flex-1 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                        type="button"
                        onClick={() => onChange({ ...editState, masked: !editState.masked })}
                        className={`inline-flex h-9 w-9 items-center justify-center rounded-md border ${editState.masked ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-600'}`}
                        title={t('configs.masked')}
                        aria-label={t('configs.masked')}
                    >
                        <MaskedIcon masked={editState.masked} />
                    </button>
                    {renderActionButtons(variant, onSave, onCancel, t)}
                </div>
            ) : (
                <div className={`flex gap-3 ${rowAlign}`}>
                    <input
                        type="text"
                        value={editState.name}
                        onChange={(event) => onChange({ ...editState, name: event.target.value })}
                        onKeyDown={onKeyDown}
                        placeholder={t('configs.name.placeholder.enter')}
                        className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                        autoFocus={autoFocus}
                    />
                    <input
                        type="text"
                        value={editState.value}
                        onChange={(event) => onChange({ ...editState, value: event.target.value })}
                        onKeyDown={onKeyDown}
                        placeholder={type === 'URL' ? t('configs.url.placeholder') : t('configs.value.placeholder')}
                        className="flex-[2] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {renderActionButtons(variant, onSave, onCancel, t)}
                </div>
            )}
            {isGroupableConfigType(type) && type !== 'VARIABLE' && (
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

export type { ConfigInlineEditorFormProps, ConfigInlineEditorState, ConfigInlineEditorVariant, ConfigInlineEditorRowAlign };

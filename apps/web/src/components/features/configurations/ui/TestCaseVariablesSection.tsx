import type { KeyboardEvent, MutableRefObject } from 'react';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType } from '@/types';
import { compareByGroupThenName } from '@/lib/test-config/sort';
import { getConfigTypeTitleKey } from '@/components/features/configurations/model/config-utils';
import GroupSelectInput from '@/components/features/configurations/ui/GroupSelectInput';
import { ADDABLE_TEST_CASE_CONFIG_TYPES, RANDOM_STRING_GENERATION_TYPES, TYPE_ORDER, randomStringGenerationLabel } from '../model/config-helpers';
import type { EditState, FileUploadDraft } from '../model/config-types';
import TestCaseConfigInlineEditor from './TestCaseConfigInlineEditor';

interface TestCaseVariablesSectionProps {
    readOnly?: boolean;
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
    testCaseId?: string;
    onEnsureTestCaseId?: () => Promise<string | null>;
    addTypeOpen: boolean;
    setAddTypeOpen: (open: boolean) => void;
    addTypeRef: MutableRefObject<HTMLDivElement | null>;
    editState: EditState | null;
    setEditState: (state: EditState | null) => void;
    error: string | null;
    setError: (error: string | null) => void;
    fileUploadDraft: FileUploadDraft | null;
    setFileUploadDraft: (draft: FileUploadDraft | null) => void;
    randomStringDropdownOpen: string | null;
    setRandomStringDropdownOpen: (value: string | null) => void;
    randomStringDropdownRefs: MutableRefObject<Map<string, HTMLDivElement>>;
    testCaseGroupOptions: string[];
    onSave: () => void;
    onDelete: (configId: string) => void;
    onRemoveGroup: (group: string) => void;
    onDownload: (config: ConfigItem) => void;
    onEdit: (config: ConfigItem) => void;
    onFileUploadSave: (draft?: FileUploadDraft | null) => void;
    onConfigEditorKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
}

function TypeSubHeader({ type, t }: { type: ConfigType; t: (key: string) => string }) {
    return (
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-2 first:pt-0">
            {t(getConfigTypeTitleKey(type))}
        </div>
    );
}

export default function TestCaseVariablesSection({
    readOnly,
    projectConfigs,
    testCaseConfigs,
    testCaseId,
    onEnsureTestCaseId,
    addTypeOpen,
    setAddTypeOpen,
    addTypeRef,
    editState,
    setEditState,
    error,
    setError,
    fileUploadDraft,
    setFileUploadDraft,
    randomStringDropdownOpen,
    setRandomStringDropdownOpen,
    randomStringDropdownRefs,
    testCaseGroupOptions,
    onSave,
    onDelete,
    onRemoveGroup,
    onDownload,
    onEdit,
    onFileUploadSave,
    onConfigEditorKeyDown,
}: TestCaseVariablesSectionProps) {
    const { t } = useI18n();
    const groupedByType = TYPE_ORDER
        .map((type) => ({
            type,
            items: testCaseConfigs
                .filter((config) => config.type === type)
                .sort(compareByGroupThenName),
        }))
        .filter((group) => group.items.length > 0);

    const renderRandomStringDropdown = (dropdownKey: string, value: string) => (
        <div
            className="relative"
            ref={(el) => {
                if (el) {
                    randomStringDropdownRefs.current.set(dropdownKey, el);
                    return;
                }
                randomStringDropdownRefs.current.delete(dropdownKey);
            }}
        >
            <button
                type="button"
                onClick={() => setRandomStringDropdownOpen(randomStringDropdownOpen === dropdownKey ? null : dropdownKey)}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white text-left focus:outline-none focus:ring-1 focus:ring-primary flex items-center justify-between gap-2"
            >
                <span className="truncate">{randomStringGenerationLabel(value, t)}</span>
                <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {randomStringDropdownOpen === dropdownKey && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-[180px]">
                    {RANDOM_STRING_GENERATION_TYPES.map((generationType) => (
                        <button
                            key={generationType}
                            type="button"
                            onClick={() => {
                                if (!editState) return;
                                setEditState({ ...editState, value: generationType });
                                setRandomStringDropdownOpen(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${value === generationType ? 'bg-gray-50 text-gray-900' : 'text-gray-700'}`}
                        >
                            {randomStringGenerationLabel(generationType, t)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('configs.section.testCaseVariables')}</span>
                {!readOnly && (testCaseId || onEnsureTestCaseId) && (
                    <div className="relative" ref={addTypeRef}>
                        <button
                            type="button"
                            onClick={() => setAddTypeOpen(!addTypeOpen)}
                            className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            {t('configs.add')}
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {addTypeOpen && (
                            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 py-1 min-w-[150px]">
                                {ADDABLE_TEST_CASE_CONFIG_TYPES.map((type) => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => {
                                            if (type === 'FILE') {
                                                setEditState(null);
                                                setFileUploadDraft({ name: '', group: '', file: null });
                                                setError(null);
                                                setRandomStringDropdownOpen(null);
                                            } else {
                                                setFileUploadDraft(null);
                                                setEditState({
                                                    name: '',
                                                    value: type === 'RANDOM_STRING' ? 'TIMESTAMP_DATETIME' : '',
                                                    type,
                                                    masked: false,
                                                    group: '',
                                                });
                                                setError(null);
                                            }
                                            setAddTypeOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                                    >
                                        {t(`configs.type.${type.toLowerCase()}`)}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="space-y-0.5">
                {groupedByType.map(({ type, items }) => (
                    <div key={type}>
                        <TypeSubHeader type={type as ConfigType} t={t} />
                        {items.map((config) => {
                            const isEditingThis = editState?.id === config.id;
                            const overridesProject = projectConfigs.some((pc) => pc.name === config.name);

                            if (isEditingThis && editState) {
                                const randomDropdownKey = `existing-${config.id}`;
                                return (
                                    <TestCaseConfigInlineEditor
                                        key={config.id}
                                        type={config.type}
                                        editState={editState}
                                        error={error}
                                        groupOptions={testCaseGroupOptions}
                                        onChange={setEditState}
                                        onSave={onSave}
                                        onCancel={() => {
                                            setEditState(null);
                                            setError(null);
                                            setRandomStringDropdownOpen(null);
                                        }}
                                        onRemoveGroup={onRemoveGroup}
                                        onKeyDown={onConfigEditorKeyDown}
                                        renderRandomStringControl={(value) => renderRandomStringDropdown(randomDropdownKey, value)}
                                    />
                                );
                            }

                            if (config.type === 'FILE') {
                                return (
                                    <div key={config.id} className="group flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                                        {config.group && (
                                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-600">{config.group}</span>
                                        )}
                                        <code className="font-mono text-xs text-gray-800">{config.name}</code>
                                        <span className="truncate text-xs text-gray-400">{config.filename || config.value}</span>
                                        {!readOnly && (
                                            <div className="ml-auto flex gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => onDownload(config)}
                                                    className="p-1 text-gray-400 hover:text-gray-600"
                                                    title={t('common.download')}
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                    </svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onDelete(config.id)}
                                                    className="p-1 text-gray-400 hover:text-red-500"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            }

                            return (
                                <div key={config.id} className="group flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                                    {config.group && (
                                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-600">{config.group}</span>
                                    )}
                                    <code className="font-mono text-xs text-gray-800">{config.name}</code>
                                    <span className="truncate text-xs text-gray-400">
                                        {config.masked ? '••••••' : config.type === 'RANDOM_STRING' ? randomStringGenerationLabel(config.value, t) : config.value}
                                    </span>
                                    {overridesProject && (
                                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">{t('configs.override')}</span>
                                    )}
                                    {!readOnly && (
                                        <div className="ml-auto flex gap-1">
                                            <button
                                                type="button"
                                                onClick={() => onEdit(config)}
                                                className="p-1 text-gray-400 hover:text-gray-600"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                </svg>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onDelete(config.id)}
                                                className="p-1 text-gray-400 hover:text-red-500"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}

                {editState && !editState.id && (
                    <TestCaseConfigInlineEditor
                        type={editState.type}
                        editState={editState}
                        error={error}
                        autoFocus
                        groupOptions={testCaseGroupOptions}
                        onChange={setEditState}
                        onSave={onSave}
                        onCancel={() => {
                            setEditState(null);
                            setError(null);
                            setRandomStringDropdownOpen(null);
                        }}
                        onRemoveGroup={onRemoveGroup}
                        onKeyDown={onConfigEditorKeyDown}
                        renderRandomStringControl={(value) => renderRandomStringDropdown('new-random-string', value)}
                    />
                )}

                {fileUploadDraft && (
                    <div className="p-2 bg-blue-50/50 rounded">
                        <div className="flex gap-2 items-center">
                            <input
                                type="text"
                                value={fileUploadDraft.name}
                                onChange={(e) => setFileUploadDraft({ ...fileUploadDraft, name: e.target.value })}
                                placeholder={t('configs.name.placeholder.enter')}
                                className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                autoFocus
                            />
                            <div className="flex-[2]">
                                <input
                                    type="file"
                                    onChange={(e) => {
                                        const selectedFile = e.target.files?.[0] || null;
                                        const nextDraft = { ...fileUploadDraft, file: selectedFile };
                                        setFileUploadDraft(nextDraft);
                                        if (selectedFile) {
                                            void onFileUploadSave(nextDraft);
                                        }
                                    }}
                                    className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary file:mr-2 file:px-2 file:py-1 file:border-0 file:rounded file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setFileUploadDraft(null);
                                    setError(null);
                                }}
                                className="inline-flex items-center px-2 py-1.5 text-xs text-gray-500"
                            >
                                {t('common.cancel')}
                            </button>
                        </div>
                        <div className="mt-2">
                            <GroupSelectInput
                                value={fileUploadDraft.group}
                                onChange={(group) => setFileUploadDraft({ ...fileUploadDraft, group })}
                                options={testCaseGroupOptions}
                                onRemoveOption={onRemoveGroup}
                                placeholder={t('configs.group.select')}
                                containerClassName="relative w-full"
                                inputClassName="h-8"
                            />
                        </div>
                        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                    </div>
                )}

                {testCaseConfigs.length === 0 && !editState && !fileUploadDraft && (
                    <p className="text-xs text-gray-400 py-1">—</p>
                )}
            </div>
        </div>
    );
}

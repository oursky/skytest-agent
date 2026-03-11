import type { KeyboardEvent, MutableRefObject } from 'react';
import type { ConfigItem } from '@/types';
import type { EditState, FileUploadDraft } from '../model/config-types';
import ProjectVariablesSummary from './ProjectVariablesSummary';
import TestCaseVariablesSection from './TestCaseVariablesSection';

interface ConfigurationVariablesPanelProps {
    projectId?: string;
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

export default function ConfigurationVariablesPanel({
    projectId,
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
}: ConfigurationVariablesPanelProps) {
    return (
        <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
            <ProjectVariablesSummary
                projectId={projectId}
                readOnly={readOnly}
                projectConfigs={projectConfigs}
                testCaseConfigs={testCaseConfigs}
            />
            <TestCaseVariablesSection
                readOnly={readOnly}
                projectConfigs={projectConfigs}
                testCaseConfigs={testCaseConfigs}
                testCaseId={testCaseId}
                onEnsureTestCaseId={onEnsureTestCaseId}
                addTypeOpen={addTypeOpen}
                setAddTypeOpen={setAddTypeOpen}
                addTypeRef={addTypeRef}
                editState={editState}
                setEditState={setEditState}
                error={error}
                setError={setError}
                fileUploadDraft={fileUploadDraft}
                setFileUploadDraft={setFileUploadDraft}
                randomStringDropdownOpen={randomStringDropdownOpen}
                setRandomStringDropdownOpen={setRandomStringDropdownOpen}
                randomStringDropdownRefs={randomStringDropdownRefs}
                testCaseGroupOptions={testCaseGroupOptions}
                onSave={onSave}
                onDelete={onDelete}
                onRemoveGroup={onRemoveGroup}
                onDownload={onDownload}
                onEdit={onEdit}
                onFileUploadSave={onFileUploadSave}
                onConfigEditorKeyDown={onConfigEditorKeyDown}
            />
        </div>
    );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, LoadingSpinner, Toggle } from '@/components/shared';
import { useI18n } from '@/i18n';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
    DEFAULT_SLACK_SUCCESS_TEMPLATE,
    DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE,
    DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE,
} from '@/lib/integrations/slack/template';
import { PROJECT_SLACK_NOTIFY_ON, type ProjectSlackNotifyOn } from '@/types/slack';
import { TEST_STATUS } from '@/types';
import ChannelPicker from '@/components/features/project-notifications/ui/ChannelPicker';
import TemplateEditor, { TEST_GROUP_TEMPLATE_VARIABLES } from '@/components/features/project-notifications/ui/TemplateEditor';
import {
    useProjectSlack,
    type ProjectSlackRequestError,
} from '@/components/features/project-notifications/hooks/useProjectSlack';

interface ProjectSlackSettingsProps {
    projectId: string;
    teamId: string;
}

const MAX_TEMPLATE_LENGTH = 3_500;

function formatProjectSlackError(t: (key: string, vars?: Record<string, string>) => string, error: ProjectSlackRequestError): string {
    switch (error.code) {
        case 'INVALID_CHANNEL':
            return t('project.integration.slack.error.invalidChannel');
        case 'TEAM_TOKEN_MISSING':
            return t('project.integration.slack.error.teamTokenMissing');
        case 'TEAM_TOKEN_INVALID':
            return t('project.integration.slack.error.teamTokenInvalid');
        case 'SLACK_UPSTREAM':
            return t('project.integration.slack.error.slackUpstream');
        case 'INVALID_TEMPLATE':
            return error.detail
                ? t('project.integration.slack.error.invalidTemplateWithDetail', { detail: error.detail })
                : t('project.integration.slack.error.invalidTemplate');
        case 'PROJECT_SLACK_NOT_CONFIGURED':
            return t('project.integration.slack.error.notConfigured');
        case 'PROJECT_SLACK_LOAD_FAILED':
            return t('project.integration.slack.error.loadFailed');
        case 'PROJECT_SLACK_SAVE_FAILED':
            return t('project.integration.slack.error.saveFailed');
        case 'PROJECT_SLACK_TEST_FAILED':
            return t('project.integration.slack.error.testFailed');
        default:
            return error.message;
    }
}

export default function ProjectSlackSettings({ projectId, teamId }: ProjectSlackSettingsProps) {
    const { t } = useI18n();
    const {
        settings,
        draft,
        setDraft,
        isLoading,
        isSaving,
        error,
        notice,
        save,
        resetDraft,
        sendTestMessage,
    } = useProjectSlack(projectId);
    const [groupTemplatesOpen, setGroupTemplatesOpen] = useState(false);
    const [caseTemplatesOpen, setCaseTemplatesOpen] = useState(false);
    const [rememberedCaseMode, setRememberedCaseMode] = useState<ProjectSlackNotifyOn>(PROJECT_SLACK_NOTIFY_ON.FAILED_ONLY);

    const canEnable = settings.parentTeamHasToken;
    const masterEnabled = draft.slackEnabled;
    const caseSelected = draft.slackNotifyOn !== PROJECT_SLACK_NOTIFY_ON.OFF;
    // Sub-toggles display as off while the master switch is off, even though the underlying
    // preference is preserved so re-enabling the master restores it.
    const groupEnabled = masterEnabled && draft.slackGroupNotifyEnabled;
    const caseEnabled = masterEnabled && caseSelected;
    const caseMode = caseSelected ? draft.slackNotifyOn : rememberedCaseMode;

    const groupEditable = groupEnabled;
    const caseEditable = caseEnabled;

    const templateTooLong = draft.slackFailureTemplate.length > MAX_TEMPLATE_LENGTH
        || draft.slackSuccessTemplate.length > MAX_TEMPLATE_LENGTH
        || draft.slackGroupFailureTemplate.length > MAX_TEMPLATE_LENGTH
        || draft.slackGroupSuccessTemplate.length > MAX_TEMPLATE_LENGTH;

    const isDirty = draft.slackEnabled !== settings.slackEnabled
        || draft.slackNotifyOn !== settings.slackNotifyOn
        || draft.slackChannelId !== (settings.slackChannelId ?? '')
        || draft.slackGroupNotifyEnabled !== settings.slackGroupNotifyEnabled
        || draft.slackFailureTemplate !== (settings.slackFailureTemplate ?? DEFAULT_SLACK_FAILURE_TEMPLATE)
        || draft.slackSuccessTemplate !== (settings.slackSuccessTemplate ?? DEFAULT_SLACK_SUCCESS_TEMPLATE)
        || draft.slackGroupFailureTemplate !== (settings.slackGroupFailureTemplate ?? DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE)
        || draft.slackGroupSuccessTemplate !== (settings.slackGroupSuccessTemplate ?? DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE);
    const hasValidSavedConfig = settings.parentTeamHasToken
        && settings.slackEnabled
        && Boolean(settings.slackChannelId?.trim());
    const canTestGroup = hasValidSavedConfig && settings.slackGroupNotifyEnabled && !isDirty && !isSaving;
    const canTestCase = hasValidSavedConfig && settings.slackNotifyOn !== PROJECT_SLACK_NOTIFY_ON.OFF && !isDirty && !isSaving;

    const errorText = useMemo(() => (error ? formatProjectSlackError(t, error) : null), [error, t]);

    type SlackDraft = typeof draft;
    const toSavePayload = (d: SlackDraft) => ({
        slackEnabled: d.slackEnabled,
        slackNotifyOn: d.slackNotifyOn,
        slackChannelId: d.slackChannelId.trim() || null,
        slackFailureTemplate: d.slackFailureTemplate.trim() || null,
        slackSuccessTemplate: d.slackSuccessTemplate.trim() || null,
        slackGroupNotifyEnabled: d.slackGroupNotifyEnabled,
        slackGroupFailureTemplate: d.slackGroupFailureTemplate.trim() || null,
        slackGroupSuccessTemplate: d.slackGroupSuccessTemplate.trim() || null,
    });

    // Toggles persist immediately (no Save click). On failure the optimistic change is reverted.
    const commitDraft = async (next: SlackDraft) => {
        const prev = draft;
        setDraft(next);
        const ok = await save(toSavePayload(next));
        if (!ok) {
            setDraft(prev);
        }
    };

    const setCaseMode = (mode: ProjectSlackNotifyOn) => {
        setRememberedCaseMode(mode);
        setDraft((prev) => ({ ...prev, slackNotifyOn: mode }));
    };

    const handleSave = async () => {
        await save(toSavePayload(draft));
    };

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-5">
            <div>
                <h2 className="text-base font-semibold text-gray-900">{t('project.integration.slack.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('project.integration.slack.description')}</p>
            </div>

            {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <LoadingSpinner size={16} />
                    {t('common.loading')}
                </div>
            ) : (
                <>
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <Toggle
                                checked={masterEnabled}
                                disabled={!canEnable || isSaving}
                                onChange={(value) => void commitDraft({ ...draft, slackEnabled: value })}
                            />
                            <span className="text-sm font-medium text-gray-700">{t('project.integration.slack.enable')}</span>
                        </div>
                        <p className="text-xs text-gray-500">{t('project.integration.slack.enableCaption')}</p>
                        {!canEnable && (
                            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                {t('project.integration.slack.parentTokenMissing')}
                                {' '}
                                <Link
                                    href={`/teams?teamId=${encodeURIComponent(teamId)}&tab=integration`}
                                    className="font-medium underline hover:text-amber-900"
                                >
                                    {t('project.integration.slack.openTeamIntegration')}
                                </Link>
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <ChannelPicker
                            value={draft.slackChannelId}
                            disabled={!masterEnabled || !canEnable}
                            onChange={(value) => setDraft((prev) => ({ ...prev, slackChannelId: value, slackChannelName: null }))}
                            t={(key) => t(key)}
                        />
                        <p className="text-xs text-gray-500">{t('project.integration.slack.channelScopeNote')}</p>
                        {draft.slackChannelName && (
                            <p className="text-xs text-gray-500">
                                {t('project.integration.slack.channelSelected')}
                                {' '}
                                <span className="font-medium">#{draft.slackChannelName}</span>
                            </p>
                        )}
                    </div>

                    <div className="space-y-3 rounded-md border border-gray-200 p-4">
                        <h3 className="text-sm font-semibold text-gray-900">{t('project.integration.slack.group.title')}</h3>
                        <div className="flex items-center gap-3">
                            <Toggle
                                checked={groupEnabled}
                                disabled={!masterEnabled || isSaving}
                                onChange={(value) => void commitDraft({ ...draft, slackGroupNotifyEnabled: value })}
                            />
                            <span className="text-sm font-medium text-gray-700">{t('project.integration.slack.group.enable')}</span>
                        </div>
                        <p className="text-xs text-gray-500">{t('project.integration.slack.group.suppressionNote')}</p>

                        <div className="rounded-md border border-gray-200">
                            <button
                                type="button"
                                onClick={() => setGroupTemplatesOpen((open) => !open)}
                                className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-800"
                            >
                                <span>{t('project.integration.slack.templates.heading')}</span>
                                <span className="text-xs font-normal text-primary">{groupTemplatesOpen ? t('common.hide') : t('common.show')}</span>
                            </button>
                            {groupTemplatesOpen && (
                                <div className="space-y-5 border-t border-gray-200 p-4">
                                    <TemplateEditor
                                        title={t('project.integration.slack.template.groupPassedTitle')}
                                        resetLabel={t('project.integration.slack.resetDefault')}
                                        value={draft.slackGroupSuccessTemplate}
                                        disabled={!groupEditable}
                                        variables={TEST_GROUP_TEMPLATE_VARIABLES}
                                        onChange={(value) => setDraft((prev) => ({ ...prev, slackGroupSuccessTemplate: value }))}
                                        onReset={() => setDraft((prev) => ({ ...prev, slackGroupSuccessTemplate: DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE }))}
                                    />
                                    <TemplateEditor
                                        title={t('project.integration.slack.template.groupFailedTitle')}
                                        resetLabel={t('project.integration.slack.resetDefault')}
                                        value={draft.slackGroupFailureTemplate}
                                        disabled={!groupEditable}
                                        variables={TEST_GROUP_TEMPLATE_VARIABLES}
                                        onChange={(value) => setDraft((prev) => ({ ...prev, slackGroupFailureTemplate: value }))}
                                        onReset={() => setDraft((prev) => ({ ...prev, slackGroupFailureTemplate: DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE }))}
                                    />
                                    <p className="text-xs text-gray-500">{t('project.integration.slack.template.mentionTip')}</p>
                                    <div className="flex flex-wrap gap-2">
                                        <Button onClick={() => void sendTestMessage(TEST_STATUS.PASS, 'group')} variant="secondary" disabled={!canTestGroup}>
                                            {t('project.integration.slack.sendTestGroupPassed')}
                                        </Button>
                                        <Button onClick={() => void sendTestMessage(TEST_STATUS.FAIL, 'group')} variant="secondary" disabled={!canTestGroup}>
                                            {t('project.integration.slack.sendTestGroupFailed')}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-3 rounded-md border border-gray-200 p-4">
                        <h3 className="text-sm font-semibold text-gray-900">{t('project.integration.slack.individual.title')}</h3>
                        <div className="flex items-center gap-3">
                            <Toggle
                                checked={caseEnabled}
                                disabled={!masterEnabled || isSaving}
                                onChange={(value) => {
                                    if (!value && caseSelected) {
                                        setRememberedCaseMode(draft.slackNotifyOn);
                                    }
                                    void commitDraft({
                                        ...draft,
                                        slackNotifyOn: value ? rememberedCaseMode : PROJECT_SLACK_NOTIFY_ON.OFF,
                                    });
                                }}
                            />
                            <span className="text-sm font-medium text-gray-700">{t('project.integration.slack.individual.enable')}</span>
                        </div>
                        <p className="text-xs text-gray-500">{t('project.integration.slack.individual.caption')}</p>

                        <div className="space-y-2 pl-1">
                            {[
                                { mode: PROJECT_SLACK_NOTIFY_ON.FAILED_ONLY, label: t('project.integration.slack.notifyMode.failedOnly') },
                                { mode: PROJECT_SLACK_NOTIFY_ON.BOTH_PASSED_AND_FAILED, label: t('project.integration.slack.notifyMode.bothPassedAndFailed') },
                            ].map(({ mode, label }) => (
                                <label key={mode} className={`flex items-center gap-2 text-sm ${caseEditable ? 'cursor-pointer text-gray-700' : 'text-gray-400'}`}>
                                    <input
                                        type="radio"
                                        name="slack-case-mode"
                                        checked={caseMode === mode}
                                        disabled={!caseEditable}
                                        onChange={() => setCaseMode(mode)}
                                    />
                                    <span>{label}</span>
                                </label>
                            ))}
                        </div>

                        <div className="rounded-md border border-gray-200">
                            <button
                                type="button"
                                onClick={() => setCaseTemplatesOpen((open) => !open)}
                                className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-800"
                            >
                                <span>{t('project.integration.slack.templates.heading')}</span>
                                <span className="text-xs font-normal text-primary">{caseTemplatesOpen ? t('common.hide') : t('common.show')}</span>
                            </button>
                            {caseTemplatesOpen && (
                                <div className="space-y-5 border-t border-gray-200 p-4">
                                    <TemplateEditor
                                        title={t('project.integration.slack.template.passedTitle')}
                                        resetLabel={t('project.integration.slack.resetDefault')}
                                        value={draft.slackSuccessTemplate}
                                        disabled={!caseEditable}
                                        onChange={(value) => setDraft((prev) => ({ ...prev, slackSuccessTemplate: value }))}
                                        onReset={() => setDraft((prev) => ({ ...prev, slackSuccessTemplate: DEFAULT_SLACK_SUCCESS_TEMPLATE }))}
                                    />
                                    <TemplateEditor
                                        title={t('project.integration.slack.template.failedTitle')}
                                        resetLabel={t('project.integration.slack.resetDefault')}
                                        value={draft.slackFailureTemplate}
                                        disabled={!caseEditable}
                                        onChange={(value) => setDraft((prev) => ({ ...prev, slackFailureTemplate: value }))}
                                        onReset={() => setDraft((prev) => ({ ...prev, slackFailureTemplate: DEFAULT_SLACK_FAILURE_TEMPLATE }))}
                                    />
                                    <p className="text-xs text-gray-500">{t('project.integration.slack.template.mentionTip')}</p>
                                    <div className="flex flex-wrap gap-2">
                                        <Button onClick={() => void sendTestMessage(TEST_STATUS.PASS, 'individual')} variant="secondary" disabled={!canTestCase}>
                                            {t('project.integration.slack.sendTestPassed')}
                                        </Button>
                                        <Button onClick={() => void sendTestMessage(TEST_STATUS.FAIL, 'individual')} variant="secondary" disabled={!canTestCase}>
                                            {t('project.integration.slack.sendTestFailed')}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {templateTooLong && (
                        <p className="text-xs text-amber-700">{t('project.integration.slack.templates.tooLong')}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            onClick={() => void handleSave()}
                            variant="primary"
                            disabled={!isDirty || isSaving || templateTooLong}
                        >
                            {t('common.save')}
                        </Button>
                        <Button
                            onClick={() => resetDraft()}
                            variant="secondary"
                            disabled={!isDirty || isSaving}
                        >
                            {t('common.discard')}
                        </Button>
                    </div>

                    {errorText && (
                        <p className="text-sm text-red-600">{errorText}</p>
                    )}
                    {!errorText && notice === 'saved' && (
                        <p className="text-sm text-emerald-700">{t('project.integration.slack.notice.saved')}</p>
                    )}
                    {!errorText && notice === 'tested' && (
                        <p className="text-sm text-emerald-700">{t('project.integration.slack.notice.tested')}</p>
                    )}
                </>
            )}
        </section>
    );
}

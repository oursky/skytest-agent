'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Button, LoadingSpinner } from '@/components/shared';
import { useI18n } from '@/i18n';
import { PROJECT_SLACK_NOTIFY_ON } from '@/types/slack';
import { TEST_STATUS } from '@/types';
import ChannelPicker from '@/components/features/project-notifications/ui/ChannelPicker';
import {
    useProjectSlack,
    type ProjectSlackRequestError,
} from '@/components/features/project-notifications/hooks/useProjectSlack';

interface ProjectSlackSettingsProps {
    projectId: string;
    teamId: string;
}

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
        sendTestMessage,
    } = useProjectSlack(projectId);

    const canEnable = settings.parentTeamHasToken;
    const normalizedDraftChannelId = draft.slackChannelId.trim();
    const isDirty = draft.slackEnabled !== settings.slackEnabled
        || draft.slackNotifyOn !== settings.slackNotifyOn
        || draft.slackChannelId !== (settings.slackChannelId ?? '');
    const isDraftConfigReady = !draft.slackEnabled || (canEnable && normalizedDraftChannelId.length > 0);
    const hasValidSavedConfig = settings.parentTeamHasToken
        && settings.slackEnabled
        && Boolean(settings.slackChannelId?.trim());

    const statusText = useMemo(() => (
        draft.slackEnabled
            ? t('project.integration.slack.status.enabled')
            : t('project.integration.slack.status.disabled')
    ), [draft.slackEnabled, t]);
    const errorText = useMemo(() => (error ? formatProjectSlackError(t, error) : null), [error, t]);

    const handleSave = async () => {
        await save({
            slackEnabled: draft.slackEnabled,
            slackNotifyOn: draft.slackNotifyOn,
            slackChannelId: draft.slackChannelId.trim() || null,
        });
    };

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
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
                    <label className="flex items-center gap-3 rounded-md border border-gray-200 px-3 py-2">
                        <input
                            type="checkbox"
                            checked={draft.slackEnabled}
                            disabled={!canEnable}
                            onChange={(event) => setDraft((prev) => ({ ...prev, slackEnabled: event.target.checked }))}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <span className="text-sm font-medium text-gray-700">
                            {t('project.integration.slack.enableFailedRun')}
                        </span>
                        <span className="ml-auto text-xs text-gray-500">{statusText}</span>
                    </label>

                    {!canEnable && (
                        <p className="text-sm text-amber-800">
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

                    <div className="space-y-2 rounded-md border border-gray-200 p-3">
                        <p className="text-sm font-medium text-gray-700">{t('project.integration.slack.notifyMode.title')}</p>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="radio"
                                name="slack-notify-mode"
                                checked={draft.slackNotifyOn === PROJECT_SLACK_NOTIFY_ON.FAILED_ONLY}
                                disabled={!draft.slackEnabled}
                                onChange={() => setDraft((prev) => ({ ...prev, slackNotifyOn: PROJECT_SLACK_NOTIFY_ON.FAILED_ONLY }))}
                            />
                            <span>{t('project.integration.slack.notifyMode.failedOnly')}</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="radio"
                                name="slack-notify-mode"
                                checked={draft.slackNotifyOn === PROJECT_SLACK_NOTIFY_ON.BOTH_PASSED_AND_FAILED}
                                disabled={!draft.slackEnabled}
                                onChange={() => setDraft((prev) => ({ ...prev, slackNotifyOn: PROJECT_SLACK_NOTIFY_ON.BOTH_PASSED_AND_FAILED }))}
                            />
                            <span>{t('project.integration.slack.notifyMode.bothPassedAndFailed')}</span>
                        </label>
                    </div>

                    <ChannelPicker
                        value={draft.slackChannelId}
                        disabled={!draft.slackEnabled || !canEnable}
                        onChange={(value) => setDraft((prev) => ({ ...prev, slackChannelId: value, slackChannelName: null }))}
                        t={(key) => t(key)}
                    />

                    {draft.slackChannelName && (
                        <p className="text-xs text-gray-500">
                            {t('project.integration.slack.channelSelected')}
                            {' '}
                            <span className="font-medium">#{draft.slackChannelName}</span>
                        </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                        <Button
                            onClick={() => void handleSave()}
                            variant="primary"
                            disabled={!isDirty || isSaving || !isDraftConfigReady}
                        >
                            {isSaving ? t('project.integration.slack.saving') : t('common.save')}
                        </Button>
                        <Button
                            onClick={() => void sendTestMessage(TEST_STATUS.FAIL)}
                            variant="secondary"
                            disabled={!hasValidSavedConfig || isDirty || isSaving}
                        >
                            {t('project.integration.slack.sendTestFailed')}
                        </Button>
                        <Button
                            onClick={() => void sendTestMessage(TEST_STATUS.PASS)}
                            variant="secondary"
                            disabled={!hasValidSavedConfig || isDirty || isSaving}
                        >
                            {t('project.integration.slack.sendTestPassed')}
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

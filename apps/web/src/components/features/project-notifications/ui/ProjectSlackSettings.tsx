'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Button, LoadingSpinner } from '@/components/shared';
import { useI18n } from '@/i18n';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
} from '@/lib/integrations/slack/template';
import ChannelPicker from '@/components/features/project-notifications/ui/ChannelPicker';
import TemplateEditor from '@/components/features/project-notifications/ui/TemplateEditor';
import { useProjectSlack } from '@/components/features/project-notifications/hooks/useProjectSlack';

interface ProjectSlackSettingsProps {
    projectId: string;
    teamId: string;
}

export default function ProjectSlackSettings({ projectId, teamId }: ProjectSlackSettingsProps) {
    const { t } = useI18n();
    const {
        settings,
        draft,
        setDraft,
        isLoading,
        isSaving,
        isPreviewLoading,
        preview,
        error,
        notice,
        save,
        loadPreview,
        sendTestMessage,
        searchUsers,
    } = useProjectSlack(projectId, teamId);

    useEffect(() => {
        const timer = setTimeout(() => {
            void loadPreview(draft.slackTemplate || DEFAULT_SLACK_FAILURE_TEMPLATE);
        }, 350);

        return () => clearTimeout(timer);
    }, [draft.slackTemplate, loadPreview]);

    const templateTooLong = draft.slackTemplate.length > 3_500;
    const canEnable = settings.parentTeamHasToken;
    const normalizedDraftChannelId = draft.slackChannelId.trim();
    const isDirty = draft.slackEnabled !== settings.slackEnabled
        || draft.slackChannelId !== (settings.slackChannelId ?? '')
        || draft.slackTemplate !== (settings.slackMessageTemplate ?? '');
    const isDraftConfigReady = !draft.slackEnabled || (canEnable && normalizedDraftChannelId.length > 0);
    const hasValidSavedConfig = settings.parentTeamHasToken
        && settings.slackEnabled
        && Boolean(settings.slackChannelId?.trim());

    const statusText = useMemo(() => (
        draft.slackEnabled
            ? t('project.integration.slack.status.enabled')
            : t('project.integration.slack.status.disabled')
    ), [draft.slackEnabled, t]);

    const handleSave = async () => {
        await save({
            slackEnabled: draft.slackEnabled,
            slackChannelId: draft.slackChannelId.trim() || null,
            slackMessageTemplate: draft.slackTemplate.trim() || null,
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

                    <ChannelPicker
                        value={draft.slackChannelId}
                        disabled={!draft.slackEnabled || !canEnable}
                        onChange={(value) => setDraft((prev) => ({ ...prev, slackChannelId: value, slackChannelName: null }))}
                        t={(key) => t(key)}
                    />

                    <TemplateEditor
                        value={draft.slackTemplate}
                        disabled={!draft.slackEnabled}
                        onChange={(value) => setDraft((prev) => ({ ...prev, slackTemplate: value }))}
                        onReset={() => setDraft((prev) => ({ ...prev, slackTemplate: DEFAULT_SLACK_FAILURE_TEMPLATE }))}
                        searchUsers={searchUsers}
                        t={(key) => t(key)}
                    />

                    <div className="space-y-1 text-xs">
                        {templateTooLong && (
                            <p className="text-amber-700">{t('project.integration.slack.templateTooLong')}</p>
                        )}
                        {draft.slackChannelName && (
                            <p className="text-gray-500">
                                {t('project.integration.slack.channelSelected')}
                                {' '}
                                <span className="font-medium">#{draft.slackChannelName}</span>
                            </p>
                        )}
                    </div>

                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                        <div className="mb-2 flex items-center justify-between text-sm font-medium text-gray-700">
                            <span>{t('project.integration.slack.preview')}</span>
                            {isPreviewLoading && <span className="text-xs text-gray-500">{t('common.loading')}</span>}
                        </div>
                        <pre className="whitespace-pre-wrap text-xs text-gray-700">
                            {preview?.text ?? ''}
                        </pre>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button
                            onClick={() => void handleSave()}
                            variant="primary"
                            disabled={!isDirty || isSaving || templateTooLong || !isDraftConfigReady}
                        >
                            {isSaving ? t('project.integration.slack.saving') : t('common.save')}
                        </Button>
                        <Button
                            onClick={() => void sendTestMessage()}
                            variant="secondary"
                            disabled={!hasValidSavedConfig || isDirty || isSaving}
                        >
                            {t('project.integration.slack.sendTest')}
                        </Button>
                    </div>

                    {error && (
                        <p className="text-sm text-red-600">{error}</p>
                    )}
                    {!error && notice === 'saved' && (
                        <p className="text-sm text-emerald-700">{t('project.integration.slack.notice.saved')}</p>
                    )}
                    {!error && notice === 'tested' && (
                        <p className="text-sm text-emerald-700">{t('project.integration.slack.notice.tested')}</p>
                    )}
                </>
            )}
        </section>
    );
}

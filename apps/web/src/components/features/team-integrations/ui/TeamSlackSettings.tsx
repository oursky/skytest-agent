'use client';

import { useMemo, useState } from 'react';
import { Button, LoadingSpinner } from '@/components/shared';
import { useI18n } from '@/i18n';
import { useTeamSlack } from '@/components/features/team-integrations/hooks/useTeamSlack';

interface TeamSlackSettingsProps {
    teamId: string;
}

export default function TeamSlackSettings({ teamId }: TeamSlackSettingsProps) {
    const { t } = useI18n();
    const [tokenInput, setTokenInput] = useState('');
    const {
        settings,
        isLoading,
        isSaving,
        isTesting,
        error,
        notice,
        saveToken,
        disconnect,
        testConnection,
    } = useTeamSlack(teamId);

    const statusLabel = useMemo(() => {
        if (settings.hasToken) {
            return t('team.integration.slack.status.connected');
        }
        return t('team.integration.slack.status.disconnected');
    }, [settings.hasToken, t]);

    const handleConnect = async () => {
        if (!tokenInput.trim()) {
            return;
        }
        const ok = await saveToken(tokenInput.trim());
        if (ok) {
            setTokenInput('');
        }
    };

    const handleTest = async () => {
        const result = await testConnection(tokenInput.trim() || undefined);
        if (!result.success) {
            return;
        }
        if (!settings.hasToken && result.slackTeamName) {
            setTokenInput('');
        }
    };

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div>
                <h2 className="text-base font-semibold text-gray-900">{t('team.integration.slack.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('team.integration.slack.description')}</p>
            </div>

            {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <LoadingSpinner size={16} />
                    {t('common.loading')}
                </div>
            ) : (
                <>
                    <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <div>
                            <span className="font-medium">{t('team.integration.slack.connectionStatus')}</span>
                            {' '}
                            {statusLabel}
                        </div>
                        {settings.slackTeamName && (
                            <div className="mt-1">
                                <span className="font-medium">{t('team.integration.slack.workspace')}</span>
                                {' '}
                                {settings.slackTeamName}
                            </div>
                        )}
                        {settings.slackBotUserId && (
                            <div className="mt-1">
                                <span className="font-medium">{t('team.integration.slack.botUser')}</span>
                                {' '}
                                {settings.slackBotUserId}
                            </div>
                        )}
                    </div>

                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('team.integration.slack.tokenLabel')}</span>
                        <input
                            type="password"
                            value={tokenInput}
                            onChange={(event) => setTokenInput(event.target.value)}
                            placeholder={t('team.integration.slack.tokenPlaceholder')}
                            className="h-10 w-full rounded-md border border-gray-300 px-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                    </label>

                    <div className="flex flex-wrap gap-2">
                        <Button
                            onClick={() => void handleConnect()}
                            variant="primary"
                            disabled={isSaving || isTesting || tokenInput.trim().length === 0}
                        >
                            {isSaving ? t('team.integration.slack.saving') : t('team.integration.slack.connect')}
                        </Button>
                        <Button
                            onClick={() => void handleTest()}
                            variant="secondary"
                            disabled={isSaving || isTesting || !settings.hasToken}
                        >
                            {isTesting ? t('team.integration.slack.testing') : t('team.integration.slack.test')}
                        </Button>
                        <Button
                            onClick={() => void disconnect()}
                            variant="danger"
                            disabled={isSaving || !settings.hasToken}
                        >
                            {t('team.integration.slack.disconnect')}
                        </Button>
                    </div>

                    {error && (
                        <p className="text-sm text-red-600">{error}</p>
                    )}
                    {!error && notice === 'saved' && (
                        <p className="text-sm text-emerald-700">{t('team.integration.slack.notice.saved')}</p>
                    )}
                    {!error && notice === 'removed' && (
                        <p className="text-sm text-emerald-700">{t('team.integration.slack.notice.removed')}</p>
                    )}
                    {!error && notice === 'tested' && (
                        <p className="text-sm text-emerald-700">{t('team.integration.slack.notice.tested')}</p>
                    )}

                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{t('team.integration.slack.helpPrefix')}</p>
                        <ol className="mt-2 list-decimal space-y-2 pl-4">
                            <li>
                                {t('team.integration.slack.setup.step1')}
                                {' '}
                                <a
                                    href="https://api.slack.com/apps"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-medium text-primary hover:underline"
                                >
                                    api.slack.com/apps
                                </a>
                                .
                            </li>
                            <li>
                                {t('team.integration.slack.setup.step2')}
                                {' '}
                                <a
                                    href="https://api.slack.com/authentication/oauth-v2"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-medium text-primary hover:underline"
                                >
                                    api.slack.com/authentication/oauth-v2
                                </a>
                                .
                            </li>
                            <li>
                                {t('team.integration.slack.setup.step3')}
                                {' '}
                                <a
                                    href="https://api.slack.com/scopes"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-medium text-primary hover:underline"
                                >
                                    api.slack.com/scopes
                                </a>
                                .
                            </li>
                            <li>{t('team.integration.slack.setup.step4')}</li>
                        </ol>
                    </div>
                </>
            )}
        </section>
    );
}

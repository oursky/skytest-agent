'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import type { TeamSlackSettings } from '@/types/slack';

interface TeamSlackConnectionTestResult {
    success: boolean;
    slackTeamName?: string | null;
    slackBotUserId?: string | null;
    error?: string;
}

const DEFAULT_TEAM_SLACK_SETTINGS: TeamSlackSettings = {
    hasToken: false,
    slackTeamName: null,
    slackBotUserId: null,
    slackConfigUpdatedAt: null,
};

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? fallback;
}

export function useTeamSlack(teamId: string) {
    const { getAccessToken } = useAuth();
    const [settings, setSettings] = useState<TeamSlackSettings>(DEFAULT_TEAM_SLACK_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const getHeaders = useCallback(async (): Promise<HeadersInit> => {
        const token = await getAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [getAccessToken]);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const headers = await getHeaders();
            const response = await fetch(`/api/teams/${teamId}/slack`, { headers });
            if (!response.ok) {
                throw new Error(await parseErrorMessage(response, 'Failed to load Slack settings'));
            }
            const payload = await response.json() as TeamSlackSettings;
            setSettings(payload);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Failed to load Slack settings');
        } finally {
            setIsLoading(false);
        }
    }, [getHeaders, teamId]);

    useEffect(() => {
        void load();
    }, [load]);

    const saveToken = useCallback(async (token: string): Promise<boolean> => {
        setIsSaving(true);
        setError(null);
        setNotice(null);
        try {
            const headers = await getHeaders();
            const response = await fetch(`/api/teams/${teamId}/slack`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify({ token }),
            });
            if (!response.ok) {
                throw new Error(await parseErrorMessage(response, 'Failed to save Slack token'));
            }
            setNotice('saved');
            await load();
            return true;
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Failed to save Slack token');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [getHeaders, load, teamId]);

    const disconnect = useCallback(async (): Promise<boolean> => {
        setIsSaving(true);
        setError(null);
        setNotice(null);
        try {
            const headers = await getHeaders();
            const response = await fetch(`/api/teams/${teamId}/slack`, {
                method: 'DELETE',
                headers,
            });
            if (!response.ok) {
                throw new Error(await parseErrorMessage(response, 'Failed to disconnect Slack'));
            }
            setNotice('removed');
            await load();
            return true;
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : 'Failed to disconnect Slack');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [getHeaders, load, teamId]);

    const testConnection = useCallback(async (token?: string): Promise<TeamSlackConnectionTestResult> => {
        setIsTesting(true);
        setError(null);
        setNotice(null);
        try {
            const headers = await getHeaders();
            const response = await fetch(`/api/teams/${teamId}/slack/test`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify(token ? { token } : {}),
            });
            if (!response.ok) {
                return {
                    success: false,
                    error: await parseErrorMessage(response, 'Slack connection test failed'),
                };
            }
            const payload = await response.json() as {
                slackTeamName?: string | null;
                slackBotUserId?: string | null;
            };
            setNotice('tested');
            return {
                success: true,
                slackTeamName: payload.slackTeamName ?? null,
                slackBotUserId: payload.slackBotUserId ?? null,
            };
        } finally {
            setIsTesting(false);
        }
    }, [getHeaders, teamId]);

    return {
        settings,
        isLoading,
        isSaving,
        isTesting,
        error,
        notice,
        load,
        saveToken,
        disconnect,
        testConnection,
        clearMessages: () => {
            setError(null);
            setNotice(null);
        },
    };
}

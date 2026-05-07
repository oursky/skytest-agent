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

interface SlackErrorPayload {
    error?: string;
    message?: string;
    code?: string;
}

export interface TeamSlackRequestError {
    code: string;
    message: string;
}

const DEFAULT_TEAM_SLACK_SETTINGS: TeamSlackSettings = {
    hasToken: false,
    slackTeamName: null,
    slackBotUserId: null,
    slackConfigUpdatedAt: null,
};

const ERROR_CODE_PATTERN = /^[A-Z0-9_]+$/;

function parseErrorPayload(payload: unknown): SlackErrorPayload {
    if (typeof payload !== 'object' || payload === null) {
        return {};
    }
    const record = payload as Record<string, unknown>;
    return {
        error: typeof record.error === 'string' ? record.error : undefined,
        message: typeof record.message === 'string' ? record.message : undefined,
        code: typeof record.code === 'string' ? record.code : undefined,
    };
}

function createRequestError(
    fallbackCode: string,
    fallbackMessage: string,
    payload?: SlackErrorPayload
): TeamSlackRequestError {
    const rawError = payload?.error;
    const codeFromError = rawError && ERROR_CODE_PATTERN.test(rawError) ? rawError : null;
    return {
        code: codeFromError ?? payload?.code ?? fallbackCode,
        message: payload?.message ?? (rawError && !codeFromError ? rawError : fallbackMessage),
    };
}

async function parseRequestError(
    response: Response,
    fallbackCode: string,
    fallbackMessage: string
): Promise<TeamSlackRequestError> {
    const payload = parseErrorPayload(await response.json().catch(() => null));
    return createRequestError(fallbackCode, fallbackMessage, payload);
}

export function useTeamSlack(teamId: string) {
    const { getAccessToken } = useAuth();
    const [settings, setSettings] = useState<TeamSlackSettings>(DEFAULT_TEAM_SLACK_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [error, setError] = useState<TeamSlackRequestError | null>(null);
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
                setError(await parseRequestError(
                    response,
                    'TEAM_SLACK_LOAD_FAILED',
                    'Failed to load Slack settings'
                ));
                return;
            }
            const payload = await response.json() as TeamSlackSettings;
            setSettings(payload);
        } catch (loadError) {
            setError(createRequestError(
                'TEAM_SLACK_LOAD_FAILED',
                loadError instanceof Error ? loadError.message : 'Failed to load Slack settings'
            ));
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
                setError(await parseRequestError(
                    response,
                    'TEAM_SLACK_SAVE_FAILED',
                    'Failed to save Slack token'
                ));
                return false;
            }
            setNotice('saved');
            await load();
            return true;
        } catch (saveError) {
            setError(createRequestError(
                'TEAM_SLACK_SAVE_FAILED',
                saveError instanceof Error ? saveError.message : 'Failed to save Slack token'
            ));
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
                setError(await parseRequestError(
                    response,
                    'TEAM_SLACK_DISCONNECT_FAILED',
                    'Failed to disconnect Slack'
                ));
                return false;
            }
            setNotice('removed');
            await load();
            return true;
        } catch (deleteError) {
            setError(createRequestError(
                'TEAM_SLACK_DISCONNECT_FAILED',
                deleteError instanceof Error ? deleteError.message : 'Failed to disconnect Slack'
            ));
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
                const parsed = await parseRequestError(
                    response,
                    'TEAM_SLACK_TEST_FAILED',
                    'Slack connection test failed'
                );
                setError(parsed);
                return {
                    success: false,
                    error: parsed.message,
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
        } catch (testError) {
            const fallback = createRequestError(
                'TEAM_SLACK_TEST_FAILED',
                testError instanceof Error ? testError.message : 'Slack connection test failed'
            );
            setError(fallback);
            return {
                success: false,
                error: fallback.message,
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

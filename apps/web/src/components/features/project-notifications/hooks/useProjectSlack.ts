'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { DEFAULT_SLACK_FAILURE_TEMPLATE } from '@/lib/integrations/slack/template';
import type {
    ProjectSlackSettings,
    SlackUserSummary,
} from '@/types/slack';

interface SlackPreviewResponse {
    text: string;
    truncated: boolean;
    missingVariables: string[];
}

interface SlackErrorPayload {
    error?: string;
    message?: string;
    code?: string;
    detail?: string;
    field?: string;
}

export interface ProjectSlackRequestError {
    code: string;
    message: string;
    detail: string | null;
    field: string | null;
}

const DEFAULT_PROJECT_SLACK_SETTINGS: ProjectSlackSettings = {
    slackEnabled: false,
    slackChannelId: null,
    slackChannelName: null,
    slackMessageTemplate: null,
    slackUpdatedAt: null,
    parentTeamHasToken: false,
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
        detail: typeof record.detail === 'string' ? record.detail : undefined,
        field: typeof record.field === 'string' ? record.field : undefined,
    };
}

function createRequestError(
    fallbackCode: string,
    fallbackMessage: string,
    payload?: SlackErrorPayload
): ProjectSlackRequestError {
    const rawError = payload?.error;
    const codeFromError = rawError && ERROR_CODE_PATTERN.test(rawError) ? rawError : null;
    return {
        code: codeFromError ?? payload?.code ?? fallbackCode,
        message: payload?.message ?? (rawError && !codeFromError ? rawError : fallbackMessage),
        detail: payload?.detail ?? null,
        field: payload?.field ?? null,
    };
}

async function parseRequestError(
    response: Response,
    fallbackCode: string,
    fallbackMessage: string
): Promise<ProjectSlackRequestError> {
    const payload = parseErrorPayload(await response.json().catch(() => null));
    return createRequestError(fallbackCode, fallbackMessage, payload);
}

export function useProjectSlack(projectId: string, teamId: string) {
    const { getAccessToken } = useAuth();
    const [settings, setSettings] = useState<ProjectSlackSettings>(DEFAULT_PROJECT_SLACK_SETTINGS);
    const [draft, setDraft] = useState({
        slackEnabled: false,
        slackChannelId: '',
        slackChannelName: null as string | null,
        slackTemplate: DEFAULT_SLACK_FAILURE_TEMPLATE,
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [preview, setPreview] = useState<SlackPreviewResponse | null>(null);
    const [error, setError] = useState<ProjectSlackRequestError | null>(null);
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
            const response = await fetch(`/api/projects/${projectId}/slack`, { headers });
            if (!response.ok) {
                setError(await parseRequestError(
                    response,
                    'PROJECT_SLACK_LOAD_FAILED',
                    'Failed to load project Slack settings'
                ));
                return;
            }
            const payload = await response.json() as ProjectSlackSettings;
            setSettings(payload);
            setDraft({
                slackEnabled: payload.slackEnabled,
                slackChannelId: payload.slackChannelId ?? '',
                slackChannelName: payload.slackChannelName ?? null,
                slackTemplate: payload.slackMessageTemplate ?? DEFAULT_SLACK_FAILURE_TEMPLATE,
            });
        } catch (loadError) {
            setError(createRequestError(
                'PROJECT_SLACK_LOAD_FAILED',
                loadError instanceof Error ? loadError.message : 'Failed to load project Slack settings'
            ));
        } finally {
            setIsLoading(false);
        }
    }, [getHeaders, projectId]);

    useEffect(() => {
        void load();
    }, [load]);

    const save = useCallback(async (next: {
        slackEnabled: boolean;
        slackChannelId: string | null;
        slackMessageTemplate: string | null;
    }): Promise<boolean> => {
        setIsSaving(true);
        setError(null);
        setNotice(null);
        try {
            const headers = await getHeaders();
            const response = await fetch(`/api/projects/${projectId}/slack`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify(next),
            });
            if (!response.ok) {
                setError(await parseRequestError(
                    response,
                    'PROJECT_SLACK_SAVE_FAILED',
                    'Failed to save project Slack settings'
                ));
                return false;
            }
            const payload = await response.json() as ProjectSlackSettings;
            setSettings(payload);
            setDraft({
                slackEnabled: payload.slackEnabled,
                slackChannelId: payload.slackChannelId ?? '',
                slackChannelName: payload.slackChannelName ?? null,
                slackTemplate: payload.slackMessageTemplate ?? DEFAULT_SLACK_FAILURE_TEMPLATE,
            });
            setNotice('saved');
            return true;
        } catch (saveError) {
            setError(createRequestError(
                'PROJECT_SLACK_SAVE_FAILED',
                saveError instanceof Error ? saveError.message : 'Failed to save project Slack settings'
            ));
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [getHeaders, projectId]);

    const loadPreview = useCallback(async (template: string | null): Promise<SlackPreviewResponse | null> => {
        setIsPreviewLoading(true);
        setError(null);
        try {
            const headers = await getHeaders();
            const response = await fetch(`/api/projects/${projectId}/slack/preview`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify({ template }),
            });
            if (!response.ok) {
                setError(await parseRequestError(
                    response,
                    'PROJECT_SLACK_PREVIEW_FAILED',
                    'Failed to render Slack preview'
                ));
                return null;
            }
            const payload = await response.json() as SlackPreviewResponse;
            setPreview(payload);
            return payload;
        } catch (previewError) {
            setError(createRequestError(
                'PROJECT_SLACK_PREVIEW_FAILED',
                previewError instanceof Error ? previewError.message : 'Failed to render Slack preview'
            ));
            return null;
        } finally {
            setIsPreviewLoading(false);
        }
    }, [getHeaders, projectId]);

    const sendTestMessage = useCallback(async (): Promise<boolean> => {
        setError(null);
        setNotice(null);
        try {
            const headers = await getHeaders();
            const response = await fetch(`/api/projects/${projectId}/slack/test`, {
                method: 'POST',
                headers,
            });
            if (!response.ok) {
                setError(await parseRequestError(
                    response,
                    'PROJECT_SLACK_TEST_FAILED',
                    'Failed to send test message'
                ));
                return false;
            }
            setNotice('tested');
            return true;
        } catch (sendError) {
            setError(createRequestError(
                'PROJECT_SLACK_TEST_FAILED',
                sendError instanceof Error ? sendError.message : 'Failed to send test message'
            ));
            return false;
        }
    }, [getHeaders, projectId]);

    const searchUsers = useCallback(async (query: string): Promise<SlackUserSummary[]> => {
        const headers = await getHeaders();
        const response = await fetch(
            `/api/teams/${teamId}/slack/users?q=${encodeURIComponent(query)}&limit=200`,
            { headers }
        );
        if (!response.ok) {
            const requestError = await parseRequestError(
                response,
                'PROJECT_SLACK_USER_SEARCH_FAILED',
                'Failed to list Slack users'
            );
            throw new Error(requestError.message);
        }
        const payload = await response.json() as {
            users: Array<{ id: string; displayName: string; realName: string | null; email: string | null }>;
        };

        return payload.users.map((user) => ({
            id: user.id,
            displayName: user.displayName,
            realName: user.realName,
            email: user.email,
        }));
    }, [getHeaders, teamId]);

    return {
        settings,
        draft,
        setDraft,
        isLoading,
        isSaving,
        isPreviewLoading,
        preview,
        error,
        notice,
        setNotice,
        load,
        save,
        loadPreview,
        sendTestMessage,
        searchUsers,
    };
}

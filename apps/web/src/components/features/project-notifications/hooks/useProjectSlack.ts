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

const DEFAULT_PROJECT_SLACK_SETTINGS: ProjectSlackSettings = {
    slackEnabled: false,
    slackChannelId: null,
    slackChannelName: null,
    slackMessageTemplate: null,
    slackUpdatedAt: null,
    parentTeamHasToken: false,
};

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
    const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    return payload?.message ?? payload?.error ?? fallback;
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
            const response = await fetch(`/api/projects/${projectId}/slack`, { headers });
            if (!response.ok) {
                throw new Error(await parseErrorMessage(response, 'Failed to load project Slack settings'));
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
            setError(loadError instanceof Error ? loadError.message : 'Failed to load project Slack settings');
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
                throw new Error(await parseErrorMessage(response, 'Failed to save project Slack settings'));
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
            setError(saveError instanceof Error ? saveError.message : 'Failed to save project Slack settings');
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
                throw new Error(await parseErrorMessage(response, 'Failed to render Slack preview'));
            }
            const payload = await response.json() as SlackPreviewResponse;
            setPreview(payload);
            return payload;
        } catch (previewError) {
            setError(previewError instanceof Error ? previewError.message : 'Failed to render Slack preview');
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
                throw new Error(await parseErrorMessage(response, 'Failed to send test message'));
            }
            setNotice('tested');
            return true;
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : 'Failed to send test message');
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
            throw new Error(await parseErrorMessage(response, 'Failed to list Slack users'));
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

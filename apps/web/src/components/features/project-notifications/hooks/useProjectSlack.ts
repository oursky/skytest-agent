'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
    DEFAULT_SLACK_SUCCESS_TEMPLATE,
    DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE,
    DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE,
} from '@/lib/integrations/slack/template';
import { PROJECT_SLACK_NOTIFY_ON } from '@/types/slack';
import type {
    ProjectSlackNotifyOn,
    ProjectSlackSettings,
} from '@/types/slack';
import { TEST_STATUS } from '@/types';

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
    slackNotifyOn: PROJECT_SLACK_NOTIFY_ON.FAILED_ONLY,
    slackChannelId: null,
    slackChannelName: null,
    slackFailureTemplate: null,
    slackSuccessTemplate: null,
    slackGroupNotifyEnabled: false,
    slackGroupFailureTemplate: null,
    slackGroupSuccessTemplate: null,
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

export function useProjectSlack(projectId: string) {
    const { getAccessToken } = useAuth();
    const [settings, setSettings] = useState<ProjectSlackSettings>(DEFAULT_PROJECT_SLACK_SETTINGS);
    const [draft, setDraft] = useState({
        slackEnabled: false,
        slackNotifyOn: PROJECT_SLACK_NOTIFY_ON.FAILED_ONLY as ProjectSlackNotifyOn,
        slackChannelId: '',
        slackChannelName: null as string | null,
        slackFailureTemplate: DEFAULT_SLACK_FAILURE_TEMPLATE,
        slackSuccessTemplate: DEFAULT_SLACK_SUCCESS_TEMPLATE,
        slackGroupNotifyEnabled: false,
        slackGroupFailureTemplate: DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE,
        slackGroupSuccessTemplate: DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE,
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
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
                slackNotifyOn: payload.slackNotifyOn,
                slackChannelId: payload.slackChannelId ?? '',
                slackChannelName: payload.slackChannelName ?? null,
                slackFailureTemplate: payload.slackFailureTemplate ?? DEFAULT_SLACK_FAILURE_TEMPLATE,
                slackSuccessTemplate: payload.slackSuccessTemplate ?? DEFAULT_SLACK_SUCCESS_TEMPLATE,
                slackGroupNotifyEnabled: payload.slackGroupNotifyEnabled,
                slackGroupFailureTemplate: payload.slackGroupFailureTemplate ?? DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE,
                slackGroupSuccessTemplate: payload.slackGroupSuccessTemplate ?? DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE,
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
        slackNotifyOn: ProjectSlackNotifyOn;
        slackChannelId: string | null;
        slackFailureTemplate: string | null;
        slackSuccessTemplate: string | null;
        slackGroupNotifyEnabled: boolean;
        slackGroupFailureTemplate: string | null;
        slackGroupSuccessTemplate: string | null;
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
                slackNotifyOn: payload.slackNotifyOn,
                slackChannelId: payload.slackChannelId ?? '',
                slackChannelName: payload.slackChannelName ?? null,
                slackFailureTemplate: payload.slackFailureTemplate ?? DEFAULT_SLACK_FAILURE_TEMPLATE,
                slackSuccessTemplate: payload.slackSuccessTemplate ?? DEFAULT_SLACK_SUCCESS_TEMPLATE,
                slackGroupNotifyEnabled: payload.slackGroupNotifyEnabled,
                slackGroupFailureTemplate: payload.slackGroupFailureTemplate ?? DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE,
                slackGroupSuccessTemplate: payload.slackGroupSuccessTemplate ?? DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE,
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

    const resetDraft = useCallback(() => {
        setError(null);
        setNotice(null);
        setDraft({
            slackEnabled: settings.slackEnabled,
            slackNotifyOn: settings.slackNotifyOn,
            slackChannelId: settings.slackChannelId ?? '',
            slackChannelName: settings.slackChannelName ?? null,
            slackFailureTemplate: settings.slackFailureTemplate ?? DEFAULT_SLACK_FAILURE_TEMPLATE,
            slackSuccessTemplate: settings.slackSuccessTemplate ?? DEFAULT_SLACK_SUCCESS_TEMPLATE,
            slackGroupNotifyEnabled: settings.slackGroupNotifyEnabled,
            slackGroupFailureTemplate: settings.slackGroupFailureTemplate ?? DEFAULT_SLACK_GROUP_FAILURE_TEMPLATE,
            slackGroupSuccessTemplate: settings.slackGroupSuccessTemplate ?? DEFAULT_SLACK_GROUP_SUCCESS_TEMPLATE,
        });
    }, [settings]);

    const sendTestMessage = useCallback(async (
        status: typeof TEST_STATUS.FAIL | typeof TEST_STATUS.PASS,
        scope: 'individual' | 'group' = 'individual'
    ): Promise<boolean> => {
        setError(null);
        setNotice(null);
        try {
            const headers = await getHeaders();
            const response = await fetch(`/api/projects/${projectId}/slack/test`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify({ status, scope }),
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

    return {
        settings,
        draft,
        setDraft,
        isLoading,
        isSaving,
        error,
        notice,
        setNotice,
        load,
        save,
        resetDraft,
        sendTestMessage,
    };
}

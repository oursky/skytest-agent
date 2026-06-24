'use client';

import { useAuth } from '@/app/auth-provider';
import { useCallback, useEffect, useState } from 'react';
import { type ScheduleRecord, type ScheduleUpsertInput } from '@/types';
import { extractListData } from '@/utils/pagination/pagination';

interface UseProjectSchedulesResult {
    schedules: ScheduleRecord[];
    isLoading: boolean;
    error: string | null;
    createSchedule: (input: ScheduleUpsertInput) => Promise<ScheduleRecord | null>;
    updateSchedule: (scheduleId: string, input: ScheduleUpsertInput) => Promise<ScheduleRecord | null>;
    deleteSchedule: (scheduleId: string) => Promise<boolean>;
    refetch: () => Promise<void>;
}

export function useProjectSchedules(projectId: string): UseProjectSchedulesResult {
    const { getAccessToken } = useAuth();
    const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSchedules = useCallback(async () => {
        try {
            setError(null);
            const token = await getAccessToken();
            const response = await fetch(`/api/projects/${projectId}/schedules`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({ error: 'Failed to load schedules' }));
                setError(typeof payload.error === 'string' ? payload.error : 'Failed to load schedules');
                return;
            }
            setSchedules(extractListData<ScheduleRecord>(await response.json()));
        } catch (fetchError) {
            console.error('Failed to fetch schedules', fetchError);
            setError('Failed to load schedules');
        } finally {
            setIsLoading(false);
        }
    }, [getAccessToken, projectId]);

    useEffect(() => {
        void fetchSchedules();
    }, [fetchSchedules]);

    const createSchedule = useCallback(async (input: ScheduleUpsertInput) => {
        const token = await getAccessToken();
        const response = await fetch(`/api/projects/${projectId}/schedules`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(input),
        });
        const payload = await response.json().catch(() => null) as ScheduleRecord | { error?: string } | null;
        if (!response.ok) {
            setError(payload && 'error' in payload && typeof payload.error === 'string' ? payload.error : 'Failed to save schedule');
            return null;
        }
        const schedule = payload as ScheduleRecord;
        setSchedules((previous) => [...previous, schedule]);
        return schedule;
    }, [getAccessToken, projectId]);

    const updateSchedule = useCallback(async (scheduleId: string, input: ScheduleUpsertInput) => {
        const token = await getAccessToken();
        const response = await fetch(`/api/projects/${projectId}/schedules/${scheduleId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(input),
        });
        const payload = await response.json().catch(() => null) as ScheduleRecord | { error?: string } | null;
        if (!response.ok) {
            setError(payload && 'error' in payload && typeof payload.error === 'string' ? payload.error : 'Failed to save schedule');
            return null;
        }
        const schedule = payload as ScheduleRecord;
        setSchedules((previous) => previous.map((item) => item.id === scheduleId ? schedule : item));
        return schedule;
    }, [getAccessToken, projectId]);

    const deleteSchedule = useCallback(async (scheduleId: string) => {
        const token = await getAccessToken();
        const response = await fetch(`/api/projects/${projectId}/schedules/${scheduleId}`, {
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({ error: 'Failed to delete schedule' }));
            setError(typeof payload.error === 'string' ? payload.error : 'Failed to delete schedule');
            return false;
        }
        setSchedules((previous) => previous.filter((item) => item.id !== scheduleId));
        return true;
    }, [getAccessToken, projectId]);

    return {
        schedules,
        isLoading,
        error,
        createSchedule,
        updateSchedule,
        deleteSchedule,
        refetch: fetchSchedules,
    };
}

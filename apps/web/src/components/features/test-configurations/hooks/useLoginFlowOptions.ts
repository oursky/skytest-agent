'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { extractListData } from '@/utils/pagination/pagination';

export interface LoginFlowOption {
    id: string;
    displayId?: string | null;
    name: string;
}

export function loginFlowOptionLabel(option: LoginFlowOption, separator = ' '): string {
    return option.displayId ? `${option.displayId}${separator}${option.name}` : option.name;
}

export function useLoginFlowOptions(projectId?: string): LoginFlowOption[] {
    const { getAccessToken } = useAuth();
    const [options, setOptions] = useState<LoginFlowOption[]>([]);

    useEffect(() => {
        if (!projectId) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetchWithAccessToken(
                    getAccessToken,
                    `/api/projects/${projectId}/test-cases?summary=1&kind=LOGIN_FLOW&limit=100`,
                );
                if (!response.ok) {
                    return;
                }
                const list = extractListData<LoginFlowOption>(await response.json());
                if (!cancelled) {
                    setOptions(list);
                }
            } catch {
                // A failed lookup just leaves the list empty; the field stays optional.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [projectId, getAccessToken]);

    return options;
}

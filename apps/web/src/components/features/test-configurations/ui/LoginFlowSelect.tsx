'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';

interface LoginFlowOption {
    id: string;
    displayId?: string | null;
    name: string;
}

interface LoginFlowSelectProps {
    projectId?: string;
    value?: string;
    excludeTestCaseId?: string;
    disabled?: boolean;
    onChange: (loginFlowId: string | undefined) => void;
}

export default function LoginFlowSelect({
    projectId,
    value,
    excludeTestCaseId,
    disabled,
    onChange,
}: LoginFlowSelectProps) {
    const { t } = useI18n();
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
                const body = await response.json() as { data?: LoginFlowOption[] };
                if (!cancelled && Array.isArray(body.data)) {
                    setOptions(body.data);
                }
            } catch {
                // A failed lookup just leaves the picker empty; the field stays optional.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [projectId, getAccessToken]);

    const visibleOptions = options.filter((option) => option.id !== excludeTestCaseId);

    return (
        <div>
            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.loginFlow')}</label>
            <select
                value={value ?? ''}
                onChange={(event) => onChange(event.target.value || undefined)}
                disabled={disabled}
                className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            >
                <option value="">{t('configs.browser.loginFlow.none')}</option>
                {visibleOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                        {option.displayId ? `${option.displayId} ${option.name}` : option.name}
                    </option>
                ))}
            </select>
        </div>
    );
}

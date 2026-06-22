'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { CustomSelect } from '@/components/shared';

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

    const selectOptions = useMemo(() => {
        const visibleOptions = options.filter((option) => option.id !== excludeTestCaseId);
        return [
            { value: '', label: t('configs.browser.loginFlow.none') },
            ...visibleOptions.map((option) => ({
                value: option.id,
                label: option.displayId ? `${option.displayId} ${option.name}` : option.name,
            })),
        ];
    }, [options, excludeTestCaseId, t]);

    return (
        <div>
            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.loginFlow')}</label>
            <CustomSelect
                value={value ?? ''}
                options={selectOptions}
                onChange={(next) => onChange(next || undefined)}
                disabled={disabled}
                fullWidth
                ariaLabel={t('configs.browser.loginFlow')}
                buttonClassName="mt-0.5 px-2 py-1.5 text-xs"
            />
        </div>
    );
}

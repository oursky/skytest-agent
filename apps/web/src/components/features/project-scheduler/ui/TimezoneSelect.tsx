'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { CustomSelect } from '@/components/shared';

interface TimezoneSelectProps {
    value: string;
    disabled?: boolean;
    t: (key: string, values?: Record<string, string | number>) => string;
    onChange: (value: string) => void;
}

function formatTimezoneLabel(timezone: string): string {
    const [group, ...rest] = timezone.split('/');
    if (rest.length === 0) {
        return timezone;
    }

    return `${group} / ${rest.join(' / ').replace(/_/g, ' ')}`;
}

function stripSearchLabel(option: {
    value: string;
    label: string;
    searchLabel: string;
}): { value: string; label: string } {
    return {
        value: option.value,
        label: option.label,
    };
}

export default function TimezoneSelect({ value, disabled = false, t, onChange }: TimezoneSelectProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());

    const allOptions = useMemo(() => {
        const values = typeof Intl.supportedValuesOf === 'function'
            ? Intl.supportedValuesOf('timeZone')
            : ['UTC'];
        const deduped = values.includes(value) ? values : [value, ...values];
        return deduped
            .map((timezone) => ({
                value: timezone,
                label: formatTimezoneLabel(timezone),
                searchLabel: `${timezone} ${formatTimezoneLabel(timezone)}`.toLowerCase(),
            }))
            .sort((left, right) => left.label.localeCompare(right.label));
    }, [value]);

    const options = useMemo(() => {
        const filtered = deferredSearchQuery
            ? allOptions.filter((option) => option.searchLabel.includes(deferredSearchQuery))
            : allOptions;

        if (filtered.some((option) => option.value === value)) {
            return filtered.map(stripSearchLabel);
        }

        const selected = allOptions.find((option) => option.value === value);
        if (!selected) {
            return filtered.map(stripSearchLabel);
        }

        return [selected, ...filtered]
            .map(stripSearchLabel)
            .filter((option, index, list) => list.findIndex((item) => item.value === option.value) === index);
    }, [allOptions, deferredSearchQuery, value]);

    return (
        <CustomSelect
            value={value}
            options={options}
            onChange={onChange}
            disabled={disabled}
            fullWidth
            menuHeader={(
                <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('project.scheduler.timezone.search')}
                    disabled={disabled}
                    className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
                />
            )}
            footerActionLabel={searchQuery ? t('project.scheduler.timezone.resetFilter') : undefined}
            onFooterAction={searchQuery ? () => setSearchQuery('') : undefined}
            buttonClassName="h-10 w-full rounded-md border border-gray-300 px-3 text-left text-sm"
        />
    );
}

'use client';

import { useMemo } from 'react';
import { CustomSelect } from '@/components/shared';

interface TimezoneSelectProps {
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
}

export default function TimezoneSelect({ value, disabled = false, onChange }: TimezoneSelectProps) {
    const options = useMemo(() => {
        const values = typeof Intl.supportedValuesOf === 'function'
            ? Intl.supportedValuesOf('timeZone')
            : ['UTC'];
        const deduped = values.includes(value) ? values : [value, ...values];
        return deduped.map((timezone) => ({ value: timezone, label: timezone }));
    }, [value]);

    return (
        <CustomSelect
            value={value}
            options={options}
            onChange={onChange}
            disabled={disabled}
            fullWidth
            buttonClassName="h-10 w-full rounded-md border border-gray-300 px-3 text-left text-sm"
        />
    );
}

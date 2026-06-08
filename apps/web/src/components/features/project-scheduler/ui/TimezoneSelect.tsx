'use client';

import { useMemo } from 'react';
import { CustomSelect } from '@/components/shared';
import { formatTimezoneLabel } from '../model/schedule-form';

interface TimezoneSelectProps {
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
}

const MIN_OFFSET = -12;
const MAX_OFFSET = 14;

function offsetToTimezone(offset: number): string {
    if (offset === 0) {
        return 'UTC';
    }
    // POSIX Etc/GMT zones invert the sign: Etc/GMT-8 is UTC+8.
    return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
}

export default function TimezoneSelect({ value, disabled = false, onChange }: TimezoneSelectProps) {
    const options = useMemo(() => {
        const offsetOptions = [];
        for (let offset = MIN_OFFSET; offset <= MAX_OFFSET; offset += 1) {
            const timezone = offsetToTimezone(offset);
            offsetOptions.push({ value: timezone, label: formatTimezoneLabel(timezone) });
        }
        return offsetOptions;
    }, []);

    return (
        <div className="max-w-[12rem]">
            <CustomSelect
                value={value}
                options={options}
                onChange={onChange}
                disabled={disabled}
                fullWidth
                buttonClassName="h-10 w-full rounded-md border border-gray-300 px-3 text-left text-sm"
            />
        </div>
    );
}

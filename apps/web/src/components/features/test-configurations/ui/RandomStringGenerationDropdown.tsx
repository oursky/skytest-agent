import type { MutableRefObject } from 'react';
import { useI18n } from '@/i18n';
import {
    RANDOM_STRING_GENERATION_TYPES,
    randomStringGenerationLabel,
} from '@/components/features/test-configurations/model/config-helpers';

interface RandomStringGenerationDropdownProps {
    dropdownKey: string;
    value: string;
    openKey: string | null;
    setOpenKey: (value: string | null) => void;
    dropdownRefs: MutableRefObject<Map<string, HTMLDivElement>>;
    onChange: (value: string) => void;
    variant?: 'compact' | 'default';
}

export default function RandomStringGenerationDropdown({
    dropdownKey,
    value,
    openKey,
    setOpenKey,
    dropdownRefs,
    onChange,
    variant = 'default',
}: RandomStringGenerationDropdownProps) {
    const { t } = useI18n();
    const isCompact = variant === 'compact';

    return (
        <div
            className={`relative ${isCompact ? '' : 'h-full'}`}
            ref={(element) => {
                if (element) {
                    dropdownRefs.current.set(dropdownKey, element);
                    return;
                }
                dropdownRefs.current.delete(dropdownKey);
            }}
        >
            <button
                type="button"
                onClick={() => setOpenKey(openKey === dropdownKey ? null : dropdownKey)}
                className={isCompact
                    ? 'flex w-full items-center justify-between gap-2 rounded border border-gray-300 bg-white px-2 py-1.5 text-left text-xs focus:outline-none focus:ring-1 focus:ring-primary'
                    : 'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-left text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary'}
            >
                <span className="truncate">{randomStringGenerationLabel(value, t)}</span>
                <svg className={`${isCompact ? 'h-3 w-3' : 'h-4 w-4'} shrink-0 text-gray-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {openKey === dropdownKey && (
                <div className={`absolute right-0 top-full z-20 mt-1 rounded-md border border-gray-200 bg-white py-1 shadow-lg ${isCompact ? 'min-w-[180px]' : 'min-w-[220px]'}`}>
                    {RANDOM_STRING_GENERATION_TYPES.map((generationType) => (
                        <button
                            key={generationType}
                            type="button"
                            onClick={() => {
                                onChange(generationType);
                                setOpenKey(null);
                            }}
                            className={`w-full text-left hover:bg-gray-50 ${isCompact ? 'px-3 py-1.5 text-xs' : 'px-3 py-2 text-sm'} ${value === generationType ? 'bg-gray-50 text-gray-900' : 'text-gray-700'}`}
                        >
                            {randomStringGenerationLabel(generationType, t)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

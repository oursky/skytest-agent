'use client';

interface ToggleProps {
    checked: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
    'aria-label'?: string;
}

export default function Toggle({ checked, disabled, onChange, 'aria-label': ariaLabel }: ToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-gray-300'}`}
        >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
    );
}

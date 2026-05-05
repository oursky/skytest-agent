'use client';

interface ChannelPickerProps {
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
    t: (key: string) => string;
}

export default function ChannelPicker({
    value,
    disabled,
    onChange,
    t,
}: ChannelPickerProps) {
    return (
        <div className="max-w-md space-y-2">
            <label className="block text-sm font-medium text-gray-700">
                {t('project.integration.slack.channel')}
            </label>
            <input
                type="text"
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                placeholder={t('project.integration.slack.channelPlaceholder')}
                className="h-10 w-full rounded-md border border-gray-300 px-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50"
            />
        </div>
    );
}

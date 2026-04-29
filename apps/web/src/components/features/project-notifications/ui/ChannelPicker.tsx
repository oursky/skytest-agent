'use client';

import { useState } from 'react';
import type { SlackChannelSummary } from '@/types/slack';

interface ChannelPickerProps {
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
    onPickName: (name: string | null) => void;
    searchChannels: (query: string) => Promise<SlackChannelSummary[]>;
    t: (key: string) => string;
}

export default function ChannelPicker({
    value,
    disabled,
    onChange,
    onPickName,
    searchChannels,
    t,
}: ChannelPickerProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SlackChannelSummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const runSearch = async () => {
        if (!query.trim()) {
            setResults([]);
            setError(null);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            const channels = await searchChannels(query.trim());
            setResults(channels);
        } catch (searchError) {
            setError(searchError instanceof Error ? searchError.message : t('project.integration.slack.channelSearchFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
                {t('project.integration.slack.channel')}
            </label>
            <input
                type="text"
                value={value}
                disabled={disabled}
                onChange={(event) => {
                    onChange(event.target.value);
                    onPickName(null);
                }}
                placeholder={t('project.integration.slack.channelPlaceholder')}
                className="h-10 w-full rounded-md border border-gray-300 px-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50"
            />

            <div className="flex gap-2">
                <input
                    type="text"
                    value={query}
                    disabled={disabled}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('project.integration.slack.channelSearchPlaceholder')}
                    className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50"
                />
                <button
                    type="button"
                    disabled={disabled || isLoading}
                    onClick={() => void runSearch()}
                    className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                    {isLoading ? t('common.loading') : t('project.integration.slack.search')}
                </button>
            </div>

            {results.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded-md border border-gray-200 bg-white">
                    {results.map((channel) => (
                        <li key={channel.id}>
                            <button
                                type="button"
                                onClick={() => {
                                    onChange(channel.id);
                                    onPickName(channel.name);
                                }}
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                            >
                                <span className="font-medium">#{channel.name}</span>
                                <span className="font-mono text-xs text-gray-500">{channel.id}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {error && (
                <p className="text-sm text-red-600">{error}</p>
            )}
        </div>
    );
}

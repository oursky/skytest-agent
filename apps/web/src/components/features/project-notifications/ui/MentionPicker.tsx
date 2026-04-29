'use client';

import { useState } from 'react';
import type { SlackUserSummary } from '@/types/slack';

interface MentionPickerProps {
    disabled: boolean;
    onInsertMention: (markup: string) => void;
    searchUsers: (query: string) => Promise<SlackUserSummary[]>;
    t: (key: string) => string;
}

export default function MentionPicker({
    disabled,
    onInsertMention,
    searchUsers,
    t,
}: MentionPickerProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SlackUserSummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const runSearch = async () => {
        if (!query.trim()) {
            setResults([]);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            const users = await searchUsers(query.trim());
            setResults(users);
        } catch (searchError) {
            setError(searchError instanceof Error ? searchError.message : t('project.integration.slack.userSearchFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-2 rounded-md border border-gray-200 p-3">
            <div className="text-sm font-medium text-gray-700">
                {t('project.integration.slack.mentionPickerTitle')}
            </div>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={query}
                    disabled={disabled}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('project.integration.slack.mentionSearchPlaceholder')}
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
                <ul className="max-h-40 overflow-auto rounded-md border border-gray-200">
                    {results.map((user) => (
                        <li key={user.id}>
                            <button
                                type="button"
                                onClick={() => onInsertMention(`<@${user.id}>`)}
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                            >
                                <span>{user.displayName}</span>
                                <span className="font-mono text-xs text-gray-500">{user.id}</span>
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

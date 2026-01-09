'use client';

import { BrowserConfig } from '@/types';

interface BrowserEntry {
    id: string;
    config: BrowserConfig;
}

interface BrowserConfigCardProps {
    browser: BrowserEntry;
    index: number;
    browsersCount: number;
    showPassword: boolean;
    onUpdate: (field: keyof BrowserConfig, value: string) => void;
    onRemove: () => void;
    onTogglePassword: () => void;
    readOnly?: boolean;
}

export default function BrowserConfigCard({
    browser,
    index,
    browsersCount,
    showPassword,
    onUpdate,
    onRemove,
    onTogglePassword,
    readOnly
}: BrowserConfigCardProps) {
    const colors = ['bg-blue-500', 'bg-purple-500', 'bg-orange-500', 'bg-green-500', 'bg-pink-500'];
    const colorClass = colors[index % colors.length];

    const niceName = browser.id.startsWith('browser_')
        ? browser.id.replace('browser_', 'Browser ').toUpperCase()
        : browser.id;

    return (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4 relative">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${colorClass}`}></span>
                    <h3 className="font-medium text-gray-900">{niceName} Configuration</h3>
                </div>
                {browsersCount > 1 && !readOnly && (
                    <button
                        type="button"
                        onClick={onRemove}
                        className="text-gray-400 hover:text-red-500 text-sm"
                    >
                        Remove
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                    <label className="text-xs font-medium text-gray-500 uppercase">URL</label>
                    <input
                        type="url"
                        required
                        className="input-field mt-1"
                        placeholder="https://app.example.com"
                        value={browser.config.url}
                        onChange={(e) => onUpdate('url', e.target.value)}
                        disabled={readOnly}
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-gray-500 uppercase">Username</label>
                    <input
                        type="text"
                        className="input-field mt-1"
                        value={browser.config.username}
                        onChange={(e) => onUpdate('username', e.target.value)}
                        disabled={readOnly}
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-gray-500 uppercase">Password</label>
                    <div className="relative mt-1">
                        <input
                            type="text"
                            className={`input-field pr-10 ${!showPassword ? 'text-security-disc' : ''}`}
                            value={browser.config.password}
                            onChange={(e) => onUpdate('password', e.target.value)}
                            disabled={readOnly}
                        />
                        <button
                            type="button"
                            onClick={onTogglePassword}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                        >
                            {showPassword ? 'Hide' : 'Show'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export type { BrowserEntry, BrowserConfigCardProps };

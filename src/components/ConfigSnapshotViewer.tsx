'use client';

import { useI18n } from '@/i18n';
import type { ConfigType } from '@/types';

interface SnapshotConfig {
    name: string;
    type: ConfigType;
    value: string;
    source: string;
}

interface ConfigSnapshotViewerProps {
    configs: SnapshotConfig[];
}

export default function ConfigSnapshotViewer({ configs }: ConfigSnapshotViewerProps) {
    const { t } = useI18n();

    if (configs.length === 0) return null;

    const getTypeIcon = (type: ConfigType) => {
        switch (type) {
            case 'URL': return '🔗';
            case 'VARIABLE': return '📝';
            case 'SECRET': return '🔒';
            case 'FILE': return '📎';
        }
    };

    return (
        <div className="border border-gray-200 rounded-lg bg-white">
            <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">{t('configs.snapshot.title')}</h3>
            </div>
            <div className="divide-y divide-gray-50">
                {configs.map((config, i) => (
                    <div key={i} className="flex items-center gap-2 px-4 py-2.5">
                        <span className="text-xs">{getTypeIcon(config.type)}</span>
                        <code className="font-mono text-xs text-gray-800 font-medium">{config.name}</code>
                        <span className="text-xs text-gray-400 truncate">
                            {config.type === 'SECRET' ? '••••••' : config.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

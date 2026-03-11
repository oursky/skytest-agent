import Link from 'next/link';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType } from '@/types';
import { compareByGroupThenName } from '@/lib/test-config/sort';
import { getConfigTypeTitleKey } from '@/components/features/test-configurations/model/config-utils';
import { randomStringGenerationLabel, TYPE_ORDER } from '../model/config-helpers';

interface ProjectVariablesSummaryProps {
    projectId?: string;
    readOnly?: boolean;
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
}

function TypeSubHeader({ type, t }: { type: ConfigType; t: (key: string) => string }) {
    return (
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-2 first:pt-0">
            {t(getConfigTypeTitleKey(type))}
        </div>
    );
}

export default function ProjectVariablesSummary({
    projectId,
    readOnly,
    projectConfigs,
    testCaseConfigs,
}: ProjectVariablesSummaryProps) {
    const { t } = useI18n();
    const overriddenNames = new Set(testCaseConfigs.map((config) => config.name));
    const groupedByType = TYPE_ORDER
        .map((type) => ({
            type,
            items: projectConfigs
                .filter((config) => config.type === type)
                .sort(compareByGroupThenName),
        }))
        .filter((group) => group.items.length > 0);

    return (
        <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('configs.section.projectVariables')}</span>
                {!readOnly && projectId && (
                    <Link
                        href={`/projects/${projectId}?tab=configs`}
                        className="text-xs text-primary hover:text-primary/80"
                    >
                        {t('configs.manage')} →
                    </Link>
                )}
            </div>
            {projectConfigs.length > 0 ? (
                <div className="space-y-0.5">
                    {groupedByType.map(({ type, items }) => (
                        <div key={type}>
                            <TypeSubHeader type={type as ConfigType} t={t} />
                            {items.map((config) => (
                                <div
                                    key={config.id}
                                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${overriddenNames.has(config.name) ? 'opacity-50 line-through' : ''}`}
                                >
                                    {config.group && (
                                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-600">{config.group}</span>
                                    )}
                                    <code className="font-mono text-xs text-gray-800">{config.name}</code>
                                    <span className="truncate text-xs text-gray-400">
                                        {config.masked
                                            ? '••••••'
                                            : config.type === 'FILE'
                                                ? (config.filename || config.value)
                                                : config.type === 'RANDOM_STRING'
                                                    ? randomStringGenerationLabel(config.value, t)
                                                    : config.value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-gray-400 py-1">{t('configs.section.projectVariables.empty')}</p>
            )}
        </div>
    );
}

import Link from 'next/link';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType } from '@/types';
import { getConfigTypeTitleKey } from '@/components/features/configurations/model/config-utils';
import { randomStringGenerationLabel, sortConfigs } from '../model/config-helpers';

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
    const sortedProjectConfigs = sortConfigs(projectConfigs);

    const renderConfigsByType = (configs: ConfigItem[], renderItem: (config: ConfigItem, type: ConfigType) => React.ReactNode) => {
        let lastType: ConfigType | null = null;
        const elements: React.ReactNode[] = [];
        for (const config of configs) {
            if (config.type !== lastType) {
                elements.push(<TypeSubHeader key={`header-${config.type}-${config.id}`} type={config.type} t={t} />);
                lastType = config.type;
            }
            elements.push(renderItem(config, config.type));
        }
        return elements;
    };

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
                    {renderConfigsByType(sortedProjectConfigs, (config) => (
                        <div
                            key={config.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${overriddenNames.has(config.name) ? 'opacity-50 line-through' : ''}`}
                        >
                            <code className="font-mono text-gray-800 text-xs">{config.name}</code>
                            <span className="text-gray-400 text-xs truncate">
                                {config.masked ? '••••••' : config.type === 'FILE' ? (config.filename || config.value) : config.type === 'RANDOM_STRING' ? randomStringGenerationLabel(config.value, t) : config.value}
                            </span>
                            {config.group && (
                                <span className="text-[10px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded uppercase">{config.group}</span>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-gray-400 py-1">{t('configs.section.projectVariables.empty')}</p>
            )}
        </div>
    );
}

'use client';

import { useI18n } from '@/i18n';

interface ConfigHintsProps {
    compact?: boolean;
}

export default function ConfigHints({ compact = false }: ConfigHintsProps) {
    const { t } = useI18n();

    const containerClass = compact
        ? 'border border-gray-200 rounded-lg bg-gray-50 p-4 space-y-3'
        : 'p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 space-y-3';
    const introClass = compact
        ? 'text-xs text-gray-600 leading-snug'
        : 'text-[11px] text-gray-500 leading-snug';
    const headingClass = compact
        ? 'text-xs font-medium text-gray-700'
        : 'font-medium text-gray-700';
    const codeClass = compact
        ? 'block mt-1 bg-white border border-gray-200 px-2 py-1.5 rounded text-[11px] text-gray-600 whitespace-pre-wrap'
        : 'block bg-white border border-gray-200 px-2 py-1.5 rounded text-gray-600 whitespace-pre-wrap';

    return (
        <div className={containerClass}>
            <p className={introClass}>{t('configs.hint.intro')}</p>
            <div>
                <p className={headingClass}>{t('configs.hint.aiStep')}</p>
                <code className={codeClass}>{t('configs.hint.aiExample')}</code>
            </div>
            <div>
                <p className={headingClass}>{t('configs.hint.codeStep')}</p>
                <code className={codeClass}>{t('configs.hint.codeExample')}</code>
            </div>
        </div>
    );
}

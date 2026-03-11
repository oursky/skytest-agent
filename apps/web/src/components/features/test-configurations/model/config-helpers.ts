import type { ConfigItem, ConfigType } from '@/types';
import { compareByGroupThenName } from '@/lib/test-config/sort';

export const TYPE_ORDER: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'FILE', 'RANDOM_STRING'];
export const ADDABLE_TEST_CASE_CONFIG_TYPES: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE'];
export const RANDOM_STRING_GENERATION_TYPES = ['TIMESTAMP_DATETIME', 'TIMESTAMP_UNIX', 'UUID'] as const;

export function sortConfigs(configs: ConfigItem[]): ConfigItem[] {
    return [...configs].sort((a, b) => {
        const byGroup = compareByGroupThenName(a, b);
        if (byGroup !== 0) {
            return byGroup;
        }
        const typeA = TYPE_ORDER.indexOf(a.type);
        const typeB = TYPE_ORDER.indexOf(b.type);
        if (typeA !== typeB) return typeA - typeB;
        return 0;
    });
}

export function randomStringGenerationLabel(value: string, t: (key: string) => string): string {
    switch (value) {
        case 'TIMESTAMP_UNIX': return t('configs.randomString.timestampUnix');
        case 'TIMESTAMP_DATETIME': return t('configs.randomString.timestampDatetime');
        case 'UUID': return t('configs.randomString.uuid');
        default: return value;
    }
}

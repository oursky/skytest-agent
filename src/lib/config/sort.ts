import type { ConfigType } from '@/types';
import { normalizeConfigName } from '@/lib/config-validation';

export interface GroupSortableConfig {
    name: string;
    group?: string | null;
}

export const GROUPABLE_CONFIG_TYPES: ConfigType[] = ['VARIABLE', 'RANDOM_STRING', 'FILE'];

export function isGroupableConfigType(type: ConfigType): boolean {
    return GROUPABLE_CONFIG_TYPES.includes(type);
}

export function normalizeConfigGroup(group?: string | null): string {
    return normalizeConfigName(group || '');
}

export function compareByGroupThenName<T extends GroupSortableConfig>(a: T, b: T): number {
    const groupA = normalizeConfigGroup(a.group);
    const groupB = normalizeConfigGroup(b.group);
    const hasGroupA = groupA.length > 0;
    const hasGroupB = groupB.length > 0;

    if (hasGroupA !== hasGroupB) {
        return hasGroupA ? 1 : -1;
    }

    if (hasGroupA && hasGroupB) {
        const groupDiff = groupA.localeCompare(groupB, undefined, { sensitivity: 'base' });
        if (groupDiff !== 0) {
            return groupDiff;
        }
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

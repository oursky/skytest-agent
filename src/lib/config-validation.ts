import type { ConfigType } from '@/types';

const VALID_CONFIG_TYPES: ConfigType[] = ['URL', 'VARIABLE', 'SECRET', 'RANDOM_STRING', 'FILE', 'APP_ID'];

export function normalizeConfigName(name: string): string {
    return name.trim().toUpperCase();
}

export function validateConfigName(name: string): string | null {
    if (!name || !name.trim()) return 'Name is required';
    return null;
}

export function validateConfigType(type: string): type is ConfigType {
    return VALID_CONFIG_TYPES.includes(type as ConfigType);
}

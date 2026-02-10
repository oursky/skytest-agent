import type { ConfigType } from '@/types';

const CONFIG_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;
const VALID_CONFIG_TYPES: ConfigType[] = ['URL', 'VARIABLE', 'SECRET', 'FILE'];

export function validateConfigName(name: string): string | null {
    if (!name) return 'Name is required';
    if (!CONFIG_NAME_REGEX.test(name)) {
        return 'Name must be UPPER_SNAKE_CASE (e.g. MY_VARIABLE)';
    }
    return null;
}

export function validateConfigType(type: string): type is ConfigType {
    return VALID_CONFIG_TYPES.includes(type as ConfigType);
}

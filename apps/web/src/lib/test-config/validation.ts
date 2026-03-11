import type { ConfigType } from '@/types';

const VALID_CONFIG_TYPES: ConfigType[] = ['URL', 'VARIABLE', 'RANDOM_STRING', 'FILE', 'APP_ID'];

export function normalizeConfigName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
        return '';
    }

    const withSeparatedWords = trimmed
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
    const snakeCaseName = withSeparatedWords
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();

    if (!snakeCaseName) {
        return 'VAR';
    }

    return /^[A-Z]/.test(snakeCaseName)
        ? snakeCaseName
        : `VAR_${snakeCaseName}`;
}

export function validateConfigName(name: string): string | null {
    if (!name || !name.trim()) return 'Name is required';
    return null;
}

export function validateConfigType(type: string): type is ConfigType {
    return VALID_CONFIG_TYPES.includes(type as ConfigType);
}

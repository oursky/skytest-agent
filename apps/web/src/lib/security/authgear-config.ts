import type { AuthgearRuntimeConfig } from '@/types';

function readConfigValue(primaryKey: string, legacyKey: string): string {
    const primaryValue = process.env[primaryKey]?.trim();
    if (primaryValue) {
        return primaryValue;
    }

    const legacyValue = process.env[legacyKey]?.trim();
    return legacyValue || '';
}

export function getAuthgearRuntimeConfig(): AuthgearRuntimeConfig {
    return {
        clientId: readConfigValue('AUTHGEAR_CLIENT_ID', 'NEXT_PUBLIC_AUTHGEAR_CLIENT_ID'),
        endpoint: readConfigValue('AUTHGEAR_ENDPOINT', 'NEXT_PUBLIC_AUTHGEAR_ENDPOINT'),
        redirectUri: readConfigValue('AUTHGEAR_REDIRECT_URI', 'NEXT_PUBLIC_AUTHGEAR_REDIRECT_URI'),
    };
}

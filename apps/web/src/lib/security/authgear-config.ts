import type { AuthgearRuntimeConfig } from '@/types';

function readConfigValue(key: string): string {
    return process.env[key]?.trim() || '';
}

export function getAuthgearRuntimeConfig(): AuthgearRuntimeConfig {
    return {
        clientId: readConfigValue('AUTHGEAR_CLIENT_ID'),
        endpoint: readConfigValue('AUTHGEAR_ENDPOINT'),
        redirectUri: readConfigValue('AUTHGEAR_REDIRECT_URI'),
    };
}

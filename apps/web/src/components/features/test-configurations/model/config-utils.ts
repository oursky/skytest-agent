import type { ConfigItem, ConfigType } from '@/types';
import { isGroupableConfigType, normalizeConfigGroup } from '@/lib/test-config/sort';

export type ConfigScope = {
    kind: 'project' | 'test-case';
    id: string;
};

const CONFIG_TYPE_TITLE_KEYS: Record<ConfigType, string> = {
    URL: 'configs.title.urls',
    APP_ID: 'configs.title.appIds',
    VARIABLE: 'configs.title.variables',
    RANDOM_STRING: 'configs.title.randomStrings',
    FILE: 'configs.title.files',
};

export function getConfigTypeTitleKey(type: ConfigType): string {
    return CONFIG_TYPE_TITLE_KEYS[type];
}

export function collectConfigGroupOptions(configs: ConfigItem[]): string[] {
    const groups = new Set<string>();
    for (const config of configs) {
        if (!isGroupableConfigType(config.type)) continue;
        const group = normalizeConfigGroup(config.group);
        if (group) {
            groups.add(group);
        }
    }
    return [...groups].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function buildConfigsBasePath(scope: ConfigScope): string {
    return scope.kind === 'project'
        ? `/api/projects/${scope.id}/configs`
        : `/api/test-cases/${scope.id}/configs`;
}

export function buildConfigsEndpoint(scope: ConfigScope): string {
    return buildConfigsBasePath(scope);
}

export function buildConfigItemEndpoint(scope: ConfigScope, configId: string): string {
    return `${buildConfigsBasePath(scope)}/${configId}`;
}

export function buildConfigGroupEndpoint(scope: ConfigScope): string {
    return `${buildConfigsBasePath(scope)}/groups`;
}

export function buildConfigUploadEndpoint(scope: ConfigScope): string {
    return `${buildConfigsBasePath(scope)}/upload`;
}

export function buildConfigDownloadEndpoint(scope: ConfigScope, configId: string): string {
    return `${buildConfigsBasePath(scope)}/${configId}/download`;
}

export function buildAuthHeaders(token?: string | null, json = false): HeadersInit {
    if (json) {
        return {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
    }
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export function buildConfigDisplayValue(config: ConfigItem): string {
    if (config.type === 'FILE') {
        return config.filename || config.value;
    }
    if (config.masked) {
        return '••••••';
    }
    return config.value;
}

import type { BrowserConfig, ConfigType, ResolvedConfig, TargetConfig, TestStep } from '@/types';

export interface SnapshotPayload {
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    resolvedConfigurations?: ResolvedConfig[];
}

export interface ParsedImageDataUrl {
    mimeType: string;
    extension: string;
    contentBase64: string;
}

function isConfigType(value: string): value is ConfigType {
    return value === 'URL'
        || value === 'APP_ID'
        || value === 'VARIABLE'
        || value === 'RANDOM_STRING'
        || value === 'FILE';
}

export function parseConfigurationSnapshot(snapshot: string | null): SnapshotPayload {
    if (!snapshot) {
        return {};
    }

    try {
        const parsed = JSON.parse(snapshot) as SnapshotPayload;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function buildResolvedConfigMapsFromSnapshot(snapshot: SnapshotPayload): {
    resolvedVariables: Record<string, string>;
    resolvedFiles: Record<string, string>;
} | null {
    if (!Array.isArray(snapshot.resolvedConfigurations)) {
        return null;
    }

    const resolvedVariables: Record<string, string> = {};
    const resolvedFiles: Record<string, string> = {};

    for (const config of snapshot.resolvedConfigurations) {
        if (
            !config
            || typeof config !== 'object'
            || typeof config.name !== 'string'
            || typeof config.type !== 'string'
            || typeof config.value !== 'string'
            || !isConfigType(config.type)
        ) {
            continue;
        }

        if (config.type === 'FILE') {
            resolvedFiles[config.name] = config.value;
            if (typeof config.filename === 'string' && config.filename.length > 0) {
                resolvedFiles[config.filename] = config.value;
            }
            continue;
        }

        resolvedVariables[config.name] = config.value;
    }

    return { resolvedVariables, resolvedFiles };
}

export function parseSerializedJson<T>(value: string | null): T | undefined {
    if (!value) {
        return undefined;
    }

    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

export function parseImageDataUrl(value: string): ParsedImageDataUrl | null {
    const match = /^data:([^;]+);base64,(.+)$/i.exec(value.trim());
    if (!match) {
        return null;
    }

    const mimeType = match[1].toLowerCase();
    const contentBase64 = match[2].replace(/\s+/g, '');
    if (!contentBase64) {
        return null;
    }

    const extension = mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/png'
            ? 'png'
            : mimeType === 'image/webp'
                ? 'webp'
                : mimeType === 'image/gif'
                    ? 'gif'
                    : 'bin';

    return {
        mimeType,
        extension,
        contentBase64,
    };
}

export function toSafeScreenshotFilename(label: string, extension: string): string {
    const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const base = normalized.length > 0 ? normalized.slice(0, 80) : 'screenshot';
    return `${base}-${Date.now()}.${extension}`;
}

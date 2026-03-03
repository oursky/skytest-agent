import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { ResolvedConfig, ConfigType } from '@/types';

interface ResolvedConfigs {
    variables: Record<string, string>;
    files: Record<string, string>;
    allConfigs: ResolvedConfig[];
}

const RESOLVABLE_CONFIG_TYPES: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE'];

function generateRandomStringValue(generationType: string): string {
    switch (generationType) {
        case 'TIMESTAMP_UNIX':
            return Date.now().toString();
        case 'TIMESTAMP_DATETIME': {
            const now = new Date();
            const pad = (n: number, len = 2) => String(n).padStart(len, '0');
            return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
        }
        case 'UUID':
            return randomUUID().replace(/-/g, '');
        default:
            return randomUUID().replace(/-/g, '');
    }
}

export async function resolveConfigs(projectId: string, testCaseId?: string): Promise<ResolvedConfigs> {
    const projectConfigs = await prisma.projectConfig.findMany({
        where: {
            projectId,
            type: {
                in: RESOLVABLE_CONFIG_TYPES
            }
        },
        orderBy: { createdAt: 'asc' }
    });

    const testCaseConfigs = testCaseId
        ? await prisma.testCaseConfig.findMany({
            where: {
                testCaseId,
                type: {
                    in: RESOLVABLE_CONFIG_TYPES
                }
            },
            orderBy: { createdAt: 'asc' }
        })
        : [];

    const merged = new Map<string, ResolvedConfig>();

    for (const pc of projectConfigs) {
        merged.set(pc.name, {
            name: pc.name,
            type: pc.type as ConfigType,
            value: pc.value,
            masked: pc.masked,
            group: pc.group,
            filename: pc.filename ?? undefined,
            source: 'project',
        });
    }

    for (const tc of testCaseConfigs) {
        merged.set(tc.name, {
            name: tc.name,
            type: tc.type as ConfigType,
            value: tc.value,
            masked: tc.masked,
            group: tc.group,
            filename: tc.filename ?? undefined,
            source: 'test-case',
        });
    }

    const generatedValues = new Set<string>();
    for (const config of merged.values()) {
        if (config.type === 'RANDOM_STRING') {
            let value = generateRandomStringValue(config.value);
            while (generatedValues.has(value)) {
                value = generateRandomStringValue(config.value);
            }
            generatedValues.add(value);
            config.value = value;
        }
    }

    const variables: Record<string, string> = {};
    const files: Record<string, string> = {};

    for (const config of merged.values()) {
        if (config.type === 'FILE') {
            files[config.name] = config.value;
            if (config.filename) {
                files[config.filename] = config.value;
            }
        } else {
            variables[config.name] = config.value;
        }
    }

    return {
        variables,
        files,
        allConfigs: Array.from(merged.values()),
    };
}

const VARIABLE_REGEX = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export function substituteVariables(text: string, variables: Record<string, string>): string {
    return text.replace(VARIABLE_REGEX, (match, name: string) => {
        if (name in variables) {
            return variables[name];
        }
        return match;
    });
}

const FILE_REF_REGEX = /\{\{file:([^}]+)\}\}/g;

export function substituteFileReferences(text: string, files: Record<string, string>): string {
    return text.replace(FILE_REF_REGEX, (match, filename: string) => {
        if (filename in files) {
            return files[filename];
        }
        return match;
    });
}

export function substituteAll(text: string, variables: Record<string, string>, files: Record<string, string>): string {
    let result = substituteVariables(text, variables);
    result = substituteFileReferences(result, files);
    return result;
}

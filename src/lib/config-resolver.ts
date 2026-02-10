import { prisma } from '@/lib/prisma';
import type { ResolvedConfig, ConfigType } from '@/types';

interface ResolvedConfigs {
    variables: Record<string, string>;
    files: Record<string, string>;
    allConfigs: ResolvedConfig[];
}

export async function resolveConfigs(projectId: string, testCaseId?: string): Promise<ResolvedConfigs> {
    const projectConfigs = await prisma.projectConfig.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' }
    });

    const testCaseConfigs = testCaseId
        ? await prisma.testCaseConfig.findMany({
            where: { testCaseId },
            orderBy: { createdAt: 'asc' }
        })
        : [];

    const merged = new Map<string, ResolvedConfig>();

    for (const pc of projectConfigs) {
        merged.set(pc.name, {
            name: pc.name,
            type: pc.type as ConfigType,
            value: pc.value,
            source: 'project',
        });
    }

    for (const tc of testCaseConfigs) {
        merged.set(tc.name, {
            name: tc.name,
            type: tc.type as ConfigType,
            value: tc.value,
            source: 'test-case',
        });
    }

    const variables: Record<string, string> = {};
    const files: Record<string, string> = {};

    for (const config of merged.values()) {
        if (config.type === 'FILE') {
            const fileConfig = [...projectConfigs, ...testCaseConfigs].find(c => c.name === config.name);
            if (fileConfig?.filename) {
                files[fileConfig.filename] = config.value;
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

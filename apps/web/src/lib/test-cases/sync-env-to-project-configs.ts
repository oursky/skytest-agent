import { prisma } from '@/lib/core/prisma';

const SENSITIVE_CONFIG_NAME_PATTERN = /PASSWORD|TOKEN|SECRET|KEY/i;

export function isSensitiveConfigName(name: string): boolean {
    return SENSITIVE_CONFIG_NAME_PATTERN.test(name);
}

interface RuntimeEnvEntry {
    name: string;
    value: string;
}

export function collectSyncableEnvEntries(env: Record<string, string>): RuntimeEnvEntry[] {
    return Object.entries(env)
        .map(([name, value]) => ({
            name: name.trim(),
            value: value.trim(),
        }))
        .filter((entry) => entry.name.length > 0 && entry.value.length > 0);
}

export async function syncEnvToProjectConfigs(projectId: string, env: Record<string, string>): Promise<number> {
    const entries = collectSyncableEnvEntries(env);
    if (entries.length === 0) {
        return 0;
    }

    for (const entry of entries) {
        await prisma.projectConfig.upsert({
            where: {
                projectId_name: {
                    projectId,
                    name: entry.name,
                },
            },
            create: {
                projectId,
                name: entry.name,
                type: 'VARIABLE',
                value: entry.value,
                masked: isSensitiveConfigName(entry.name),
            },
            update: {
                type: 'VARIABLE',
                value: entry.value,
                masked: isSensitiveConfigName(entry.name),
            },
        });
    }

    return entries.length;
}

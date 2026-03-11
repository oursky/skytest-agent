import { prisma } from '@/lib/core/prisma';
import { compareByGroupThenName, isGroupableConfigType, normalizeConfigGroup } from '@/lib/config/sort';
import { validateConfigName, normalizeConfigName, validateConfigType } from '@/lib/config/validation';
import { deleteObjectKeysBestEffort } from '@/lib/mcp/storage-cleanup';
import type { ConfigType } from '@/types';

export interface ProjectConfigUpsertInput {
    name: string;
    type: string;
    value?: string;
    masked?: boolean;
    group?: string | null;
}

export interface ManageProjectConfigsInput {
    projectId: string;
    upsert?: ProjectConfigUpsertInput[];
    remove?: string[];
}

export interface ManageProjectConfigsResult {
    createdConfigs: number;
    updatedConfigs: number;
    removedConfigs: number;
    warnings: string[];
    cleanup: {
        deletedObjectCount: number;
        failedObjectKeys: string[];
    };
    configs: Array<{
        id: string;
        name: string;
        type: string;
        value: string;
        masked: boolean;
        group: string | null;
        filename: string | null;
        mimeType: string | null;
        size: number | null;
        createdAt: string;
        updatedAt: string;
    }>;
}

export async function manageProjectConfigs(input: ManageProjectConfigsInput): Promise<ManageProjectConfigsResult> {
    const upsertInputs = input.upsert ?? [];
    const removeInputs = input.remove ?? [];
    const warnings: string[] = [];

    const objectKeysForCleanup: string[] = [];

    const result = await prisma.$transaction(async (tx) => {
        let createdConfigs = 0;
        let updatedConfigs = 0;
        let removedConfigs = 0;

        const existingConfigs = await tx.projectConfig.findMany({
            where: { projectId: input.projectId },
            orderBy: { createdAt: 'asc' }
        });

        const existingByName = new Map<string, (typeof existingConfigs)[number]>();
        for (const config of existingConfigs) {
            existingByName.set(normalizeConfigName(config.name), config);
        }

        const normalizedRemoveNames = new Set<string>();
        for (const removeName of removeInputs) {
            const nameError = validateConfigName(removeName);
            if (nameError) {
                warnings.push(`Remove config "${removeName}": ${nameError}`);
                continue;
            }
            normalizedRemoveNames.add(normalizeConfigName(removeName));
        }

        for (const normalizedName of normalizedRemoveNames) {
            const existingConfig = existingByName.get(normalizedName);
            if (!existingConfig) {
                warnings.push(`Config "${normalizedName}" not found, skipped removal`);
                continue;
            }

            await tx.projectConfig.delete({ where: { id: existingConfig.id } });
            existingByName.delete(normalizedName);
            removedConfigs += 1;

            if (existingConfig.type === 'FILE' && existingConfig.value) {
                objectKeysForCleanup.push(existingConfig.value);
            }
        }

        for (const configInput of upsertInputs) {
            const nameError = validateConfigName(configInput.name);
            if (nameError) {
                warnings.push(`Config "${configInput.name}": ${nameError}`);
                continue;
            }
            if (!validateConfigType(configInput.type)) {
                warnings.push(`Config "${configInput.name}": invalid type "${configInput.type}"`);
                continue;
            }

            const normalizedName = normalizeConfigName(configInput.name);
            const configType = configInput.type as ConfigType;
            if (configType === 'FILE') {
                warnings.push(`Config "${normalizedName}" skipped: FILE upload is not supported in MCP manage_project_configs.`);
                continue;
            }

            const groupable = isGroupableConfigType(configType);
            const data = {
                name: normalizedName,
                type: configType,
                value: configInput.value ?? '',
                masked: configType === 'VARIABLE' ? (configInput.masked ?? false) : false,
                group: groupable ? (normalizeConfigGroup(configInput.group) || null) : null,
            };

            const existingConfig = existingByName.get(normalizedName);
            if (existingConfig) {
                const saved = await tx.projectConfig.update({
                    where: { id: existingConfig.id },
                    data,
                });
                existingByName.set(normalizedName, saved);
                updatedConfigs += 1;

                if (existingConfig.type === 'FILE' && existingConfig.value) {
                    objectKeysForCleanup.push(existingConfig.value);
                }
            } else {
                const createdConfig = await tx.projectConfig.create({
                    data: {
                        ...data,
                        projectId: input.projectId,
                    }
                });
                existingByName.set(normalizedName, createdConfig);
                createdConfigs += 1;
            }
        }

        const latestConfigs = await tx.projectConfig.findMany({
            where: { projectId: input.projectId },
            orderBy: { createdAt: 'asc' },
        });

        return {
            createdConfigs,
            updatedConfigs,
            removedConfigs,
            latestConfigs,
        };
    });

    const cleanup = await deleteObjectKeysBestEffort(objectKeysForCleanup);

    const sortedConfigs = [...result.latestConfigs]
        .sort(compareByGroupThenName)
        .map((config) => ({
            id: config.id,
            name: config.name,
            type: config.type,
            value: config.masked ? '' : config.value,
            masked: config.masked,
            group: config.group,
            filename: config.filename,
            mimeType: config.mimeType,
            size: config.size,
            createdAt: config.createdAt.toISOString(),
            updatedAt: config.updatedAt.toISOString(),
        }));

    return {
        createdConfigs: result.createdConfigs,
        updatedConfigs: result.updatedConfigs,
        removedConfigs: result.removedConfigs,
        warnings,
        cleanup,
        configs: sortedConfigs,
    };
}

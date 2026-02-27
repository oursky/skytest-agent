import { prisma } from '@/lib/prisma';
import { cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/test-case-utils';
import { validateConfigName, normalizeConfigName, validateConfigType } from '@/lib/config-validation';
import { isGroupableConfigType } from '@/lib/config-sort';
import { createLogger } from '@/lib/logger';
import { config as appConfig } from '@/config/app';
import type { BatchTestCaseInput, BatchCreateResult } from '@/types';
import type { TestStep, BrowserConfig, TargetConfig, ConfigType } from '@/types';

const logger = createLogger('batch-create');

export async function batchCreateTestCases(
    projectId: string,
    testCases: BatchTestCaseInput[],
    source: string = 'api'
): Promise<BatchCreateResult> {
    const maxBatch = appConfig.api.batch.maxTestCasesPerBatch;
    if (testCases.length > maxBatch) {
        throw new Error(`Maximum ${maxBatch} test cases per batch`);
    }

    const created: BatchCreateResult['created'] = [];
    const warnings: BatchCreateResult['warnings'] = [];

    for (let i = 0; i < testCases.length; i++) {
        const input = testCases[i];

        if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
            warnings.push({ index: i, message: 'Name is required, skipped' });
            continue;
        }

        try {
            const hasSteps = Array.isArray(input.steps) && input.steps.length > 0;
            const hasBrowserConfig = !!input.browserConfig
                && typeof input.browserConfig === 'object'
                && !Array.isArray(input.browserConfig)
                && Object.keys(input.browserConfig).length > 0;

            const cleanedSteps = hasSteps
                ? cleanStepsForStorage(input.steps as TestStep[])
                : undefined;
            const normalizedBrowserConfig = hasBrowserConfig
                ? normalizeTargetConfigMap(input.browserConfig as Record<string, BrowserConfig | TargetConfig>)
                : undefined;

            const testCase = await prisma.testCase.create({
                data: {
                    name: input.name.trim(),
                    url: input.url || '',
                    prompt: input.prompt,
                    steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
                    browserConfig: normalizedBrowserConfig ? JSON.stringify(normalizedBrowserConfig) : undefined,
                    projectId,
                    displayId: input.displayId || undefined,
                    status: 'DRAFT',
                    source,
                },
            });

            created.push({ id: testCase.id, name: testCase.name, index: i });

            if (Array.isArray(input.configs)) {
                for (const configInput of input.configs) {
                    const nameError = validateConfigName(configInput.name);
                    if (nameError) {
                        warnings.push({ index: i, message: `Config "${configInput.name}": ${nameError}` });
                        continue;
                    }
                    if (!validateConfigType(configInput.type)) {
                        warnings.push({ index: i, message: `Config "${configInput.name}": invalid type "${configInput.type}"` });
                        continue;
                    }

                    const normalizedName = normalizeConfigName(configInput.name);
                    const configType = configInput.type as ConfigType;
                    const groupable = isGroupableConfigType(configType);

                    try {
                        await prisma.testCaseConfig.create({
                            data: {
                                testCaseId: testCase.id,
                                name: normalizedName,
                                type: configType,
                                value: configInput.value || '',
                                masked: configType === 'VARIABLE' ? (configInput.masked ?? false) : false,
                                group: groupable ? (configInput.group?.trim() || null) : null,
                            }
                        });
                    } catch (error: unknown) {
                        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
                            warnings.push({ index: i, message: `Config "${normalizedName}" already exists, skipped` });
                        } else {
                            warnings.push({ index: i, message: `Config "${normalizedName}" creation failed` });
                            logger.error(`Failed to create config "${normalizedName}"`, error);
                        }
                    }
                }
            }
        } catch (error) {
            warnings.push({ index: i, message: `Failed to create test case "${input.name}"` });
            logger.error(`Failed to create test case at index ${i}`, error);
        }
    }

    return { created, warnings, totalCreated: created.length };
}

import { prisma } from '@/lib/core/prisma';

function uniqueNonEmpty(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        if (!value || seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }

    return result;
}

export async function loadMaskedVariableValuesForTestCase(
    projectId: string,
    testCaseId: string
): Promise<string[]> {
    const [projectConfigs, testCaseConfigs] = await Promise.all([
        prisma.projectConfig.findMany({
            where: {
                projectId,
                type: 'VARIABLE',
                masked: true,
            },
            select: {
                name: true,
                value: true,
            },
        }),
        prisma.testCaseConfig.findMany({
            where: {
                testCaseId,
                type: 'VARIABLE',
                masked: true,
            },
            select: {
                name: true,
                value: true,
            },
        }),
    ]);

    const mergedValuesByName = new Map<string, string>();

    for (const config of projectConfigs) {
        mergedValuesByName.set(config.name, config.value);
    }

    for (const config of testCaseConfigs) {
        mergedValuesByName.set(config.name, config.value);
    }

    return uniqueNonEmpty(Array.from(mergedValuesByName.values()));
}

export async function loadMaskedVariableValuesForRun(runId: string): Promise<string[]> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            testCaseId: true,
            testCase: {
                select: {
                    projectId: true,
                },
            },
        },
    });

    if (!run) {
        return [];
    }

    return loadMaskedVariableValuesForTestCase(run.testCase.projectId, run.testCaseId);
}

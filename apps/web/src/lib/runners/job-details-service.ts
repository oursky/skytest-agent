import { prisma } from '@/lib/core/prisma';
import { resolveConfigs } from '@/lib/test-config/resolver';
import { decrypt } from '@/lib/security/crypto';
import { isRunInProgressStatus, type BrowserConfig, type ConfigType, type ResolvedConfig, type TargetConfig, type TestStep } from '@/types';

interface SnapshotPayload {
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    resolvedConfigurations?: ResolvedConfig[];
}

function parseConfigurationSnapshot(snapshot: string | null): SnapshotPayload {
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

function isConfigType(value: string): value is ConfigType {
    return value === 'URL'
        || value === 'APP_ID'
        || value === 'VARIABLE'
        || value === 'RANDOM_STRING'
        || value === 'FILE';
}

function buildResolvedConfigMapsFromSnapshot(snapshot: SnapshotPayload): {
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

function parseSerializedJson<T>(value: string | null): T | undefined {
    if (!value) {
        return undefined;
    }

    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

function isRunnerRunOwned(input: {
    assignedRunnerId: string | null;
    leaseExpiresAt: Date | null;
    status: string;
    runnerId: string;
}): boolean {
    if (input.assignedRunnerId !== input.runnerId) {
        return false;
    }
    if (!input.leaseExpiresAt || input.leaseExpiresAt.getTime() <= Date.now()) {
        return false;
    }
    return isRunInProgressStatus(input.status);
}

export async function loadRunnerJobDetails(input: { runId: string; runnerId: string }) {
    const run = await prisma.testRun.findUnique({
        where: { id: input.runId },
        select: {
            id: true,
            testCaseId: true,
            status: true,
            deletedAt: true,
            configurationSnapshot: true,
            assignedRunnerId: true,
            leaseExpiresAt: true,
            files: {
                select: {
                    id: true,
                    filename: true,
                    storedName: true,
                    mimeType: true,
                    size: true,
                },
            },
            testCase: {
                select: {
                    id: true,
                    url: true,
                    prompt: true,
                    steps: true,
                    browserConfig: true,
                    projectId: true,
                    project: {
                        select: {
                            team: {
                                select: {
                                    openRouterKeyEncrypted: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!run || run.deletedAt || !isRunnerRunOwned({
        assignedRunnerId: run.assignedRunnerId,
        leaseExpiresAt: run.leaseExpiresAt,
        status: run.status,
        runnerId: input.runnerId,
    })) {
        return null;
    }

    const snapshot = parseConfigurationSnapshot(run.configurationSnapshot);
    const resolvedFromSnapshot = buildResolvedConfigMapsFromSnapshot(snapshot);
    let resolvedVariables: Record<string, string>;
    let resolvedFiles: Record<string, string>;

    if (resolvedFromSnapshot) {
        resolvedVariables = resolvedFromSnapshot.resolvedVariables;
        resolvedFiles = resolvedFromSnapshot.resolvedFiles;
    } else {
        const resolved = await resolveConfigs(run.testCase.projectId, run.testCaseId);
        resolvedVariables = resolved.variables;
        resolvedFiles = resolved.files;
    }
    const encryptedKey = run.testCase.project.team.openRouterKeyEncrypted;

    if (!encryptedKey) {
        return null;
    }

    const openRouterApiKey = decrypt(encryptedKey);

    const fallbackSteps = parseSerializedJson<TestStep[]>(run.testCase.steps);
    const fallbackBrowserConfig = parseSerializedJson<Record<string, BrowserConfig | TargetConfig>>(run.testCase.browserConfig);

    return {
        runId: run.id,
        testCaseId: run.testCase.id,
        projectId: run.testCase.projectId,
        config: {
            url: snapshot.url ?? run.testCase.url,
            prompt: snapshot.prompt ?? run.testCase.prompt ?? undefined,
            steps: snapshot.steps ?? fallbackSteps,
            browserConfig: snapshot.browserConfig ?? fallbackBrowserConfig,
            openRouterApiKey,
            files: run.files,
            resolvedVariables,
            resolvedFiles,
        },
    };
}

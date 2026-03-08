import { prisma } from '@/lib/core/prisma';
import { resolveConfigs } from '@/lib/config/resolver';
import { decrypt } from '@/lib/security/crypto';
import type { BrowserConfig, TargetConfig, TestStep } from '@/types';

interface SnapshotPayload {
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
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
    return input.status === 'PREPARING' || input.status === 'RUNNING';
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
    const resolved = await resolveConfigs(run.testCase.projectId, run.testCaseId);
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
            resolvedVariables: resolved.variables,
            resolvedFiles: resolved.files,
        },
    };
}

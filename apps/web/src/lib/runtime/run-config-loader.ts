import type { BuildMidsceneModelConfigOptions } from '@/lib/runtime/midscene-env';
import { buildTeamAiProviderConfig, resolveTeamMidsceneConfig } from '@/lib/runtime/team-ai-config';
import { prisma } from '@/lib/core/prisma';
import { resolveConfigs } from '@/lib/test-config/resolver';
import { decrypt } from '@/lib/security/crypto';
import { createLogger } from '@/lib/core/logger';
import {
    buildResolvedConfigMapsFromSnapshot,
    parseConfigurationSnapshot,
    parseSerializedJson,
} from '@/lib/runtime/local-browser-runner-parsers';
import type { LocalBrowserRunOptions } from '@/lib/runtime/local-browser-runner-lifecycle';
import {
    isRunInProgressStatus,
    type BrowserConfig,
    type TargetConfig,
    type TestCaseFile,
    type TestStep,
} from '@/types';

const logger = createLogger('runtime:run-config-loader');

export interface LoadedRunConfig {
    runId: string;
    testCaseId: string;
    projectId: string;
    kind: string;
    usage: {
        actorUserId: string;
        description: string;
    };
    config: {
        url?: string;
        prompt?: string;
        steps?: TestStep[];
        browserConfig?: Record<string, BrowserConfig | TargetConfig>;
        openRouterApiKey: string;
        teamId: string;
        aiProvider: string;
        midsceneModelOptions?: BuildMidsceneModelConfigOptions;
        files: TestCaseFile[];
        resolvedVariables: Record<string, string>;
        resolvedFiles: Record<string, string>;
    };
}

export interface LoadRunConfigOptions {
    // When true, load a run that has not yet transitioned to an in-progress
    // status. The session orchestrator owns member status transitions, so it
    // loads QUEUED members before claiming them.
    allowNonRunning?: boolean;
}

export async function loadRunConfig(
    runId: string,
    options?: LocalBrowserRunOptions,
    loadOptions?: LoadRunConfigOptions,
): Promise<LoadedRunConfig | null> {
    const nowMs = Date.now();
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            testCaseId: true,
            kind: true,
            status: true,
            assignedRunnerId: true,
            leaseExpiresAt: true,
            configurationSnapshot: true,
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
                    name: true,
                    url: true,
                    prompt: true,
                    steps: true,
                    browserConfig: true,
                    projectId: true,
                    project: {
                        select: {
                            name: true,
                            teamId: true,
                            createdByUserId: true,
                            team: {
                                select: {
                                    openRouterKeyEncrypted: true,
                                    aiProvider: true,
                                    aiBaseUrl: true,
                                    aiMainModel: true,
                                    aiMainModelFamily: true,
                                    aiPlanningModel: true,
                                    aiPlanningModelFamily: true,
                                    aiInsightModel: true,
                                    aiInsightModelFamily: true,
                                    aiTemperature: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!run || (!loadOptions?.allowNonRunning && !isRunInProgressStatus(run.status))) {
        return null;
    }

    if (options?.runnerId) {
        if (run.assignedRunnerId !== options.runnerId) {
            return null;
        }
        if (!run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= nowMs) {
            return null;
        }
    }

    if (!options?.runnerId && run.assignedRunnerId) {
        return null;
    }

    const encryptedKey = run.testCase.project.team.openRouterKeyEncrypted;
    if (!encryptedKey) {
        logger.warn('Run skipped: team AI key not configured', { runId: run.id });
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
    const fallbackSteps = parseSerializedJson<TestStep[]>(run.testCase.steps);
    const fallbackBrowserConfig = parseSerializedJson<Record<string, BrowserConfig | TargetConfig>>(run.testCase.browserConfig);
    const providerConfig = buildTeamAiProviderConfig(run.testCase.project.team);
    const midsceneModelOptions = resolveTeamMidsceneConfig(run.testCase.project.team);

    return {
        runId: run.id,
        testCaseId: run.testCase.id,
        projectId: run.testCase.projectId,
        kind: run.kind,
        usage: {
            actorUserId: run.testCase.project.createdByUserId,
            description: `${run.testCase.project.name} - ${run.testCase.name}`,
        },
        config: {
            url: snapshot.url ?? run.testCase.url,
            prompt: snapshot.prompt ?? run.testCase.prompt ?? undefined,
            steps: snapshot.steps ?? fallbackSteps,
            browserConfig: snapshot.browserConfig ?? fallbackBrowserConfig,
            openRouterApiKey: decrypt(encryptedKey),
            teamId: run.testCase.project.teamId,
            aiProvider: providerConfig.provider,
            midsceneModelOptions,
            files: run.files,
            resolvedVariables,
            resolvedFiles,
        },
    };
}

import { prisma } from '@/lib/core/prisma';
import { decrypt } from '@/lib/security/crypto';
import { buildTeamAiProviderConfig, resolveTeamMidsceneConfig, type TeamAiProviderFields } from '@/lib/runtime/team-ai-config';
import { validateAiApiKey, type AiApiKeyInvalidReason } from '@/lib/validation/ai-api-key';

const AUDIT_ENV_FLAG = 'SKYTEST_ALLOW_KEY_AUDIT';

interface DoctorArgs {
    teamId?: string;
    runId?: string;
    verbose: boolean;
}

interface TeamDoctorSource {
    teamId: string;
    runId?: string;
    team: TeamAiProviderFields & {
        openRouterKeyEncrypted: string | null;
        openRouterKeyUpdatedAt: Date | null;
    };
}

interface KeyShapeResult {
    status: 'valid' | 'invalid';
    reason: AiApiKeyInvalidReason | null;
}

const REMEDIATION_BY_REASON: Record<AiApiKeyInvalidReason, string[]> = {
    empty: [
        'Save a team AI key in Team Settings.',
        'Run this doctor again to confirm key-shape status is valid.',
    ],
    too_short: [
        'Re-save the full provider key in Team Settings.',
        'Confirm no truncation happened during copy/paste.',
    ],
    non_ascii: [
        'Re-save the key using plain ASCII characters only.',
        'Avoid whitespace, newlines, and emojis in the key field.',
    ],
};

function assertAuditEnabled(env: NodeJS.ProcessEnv): void {
    if (env[AUDIT_ENV_FLAG] !== '1') {
        throw new Error(`${AUDIT_ENV_FLAG}=1 is required to run ai-config-doctor.`);
    }
}

function parseArgs(args: string[]): DoctorArgs {
    let teamId: string | undefined;
    let runId: string | undefined;
    let verbose = false;

    for (const arg of args) {
        if (arg.startsWith('--team-id=')) {
            teamId = arg.slice('--team-id='.length).trim() || undefined;
            continue;
        }
        if (arg.startsWith('--run-id=')) {
            runId = arg.slice('--run-id='.length).trim() || undefined;
            continue;
        }
        if (arg === '--verbose') {
            verbose = true;
            continue;
        }
        throw new Error(`Unknown argument "${arg}". Use --team-id=<id> or --run-id=<id> (optional --verbose).`);
    }

    if ((teamId ? 1 : 0) + (runId ? 1 : 0) !== 1) {
        throw new Error('Provide exactly one of --team-id=<id> or --run-id=<id>.');
    }

    return { teamId, runId, verbose };
}

async function resolveTeamFromTeamId(teamId: string): Promise<TeamDoctorSource> {
    const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: {
            id: true,
            openRouterKeyEncrypted: true,
            openRouterKeyUpdatedAt: true,
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
    });

    if (!team) {
        throw new Error(`Team not found for id "${teamId}".`);
    }

    return {
        teamId: team.id,
        team,
    };
}

async function resolveTeamFromRunId(runId: string): Promise<TeamDoctorSource> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            testCase: {
                select: {
                    project: {
                        select: {
                            team: {
                                select: {
                                    id: true,
                                    openRouterKeyEncrypted: true,
                                    openRouterKeyUpdatedAt: true,
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

    const team = run?.testCase.project.team;
    if (!run || !team) {
        throw new Error(`Run not found for id "${runId}".`);
    }

    return {
        teamId: team.id,
        runId: run.id,
        team,
    };
}

function deriveKeyShape(team: TeamDoctorSource['team']): KeyShapeResult {
    if (!team.openRouterKeyEncrypted) {
        return {
            status: 'invalid',
            reason: 'empty',
        };
    }

    const decryptedKey = decrypt(team.openRouterKeyEncrypted);
    const validation = validateAiApiKey(decryptedKey);
    if (!validation.ok) {
        return {
            status: 'invalid',
            reason: validation.reason,
        };
    }

    return {
        status: 'valid',
        reason: null,
    };
}

function buildRemediation(reason: AiApiKeyInvalidReason | null): string[] {
    if (!reason) {
        return ['No API-key shape issue detected. Continue diagnosing provider/model/network signatures if runs still fail.'];
    }

    return REMEDIATION_BY_REASON[reason];
}

export async function runAiConfigDoctor(rawArgs: string[] = process.argv.slice(2)): Promise<number> {
    assertAuditEnabled(process.env);
    const args = parseArgs(rawArgs);
    const source = args.teamId
        ? await resolveTeamFromTeamId(args.teamId)
        : await resolveTeamFromRunId(args.runId!);

    const providerConfig = buildTeamAiProviderConfig(source.team);
    const modelOptions = resolveTeamMidsceneConfig(source.team);
    const keyShape = deriveKeyShape(source.team);
    const output = {
        status: keyShape.status === 'valid' ? 'pass' as const : 'fail' as const,
        scope: {
            teamId: source.teamId,
            runId: source.runId ?? null,
        },
        provider: providerConfig.provider,
        baseUrl: modelOptions.baseUrl ?? null,
        models: {
            main: {
                name: modelOptions.mainModel ?? null,
                family: modelOptions.mainModelFamily ?? null,
            },
            planning: {
                name: modelOptions.planningModel ?? null,
                family: modelOptions.planningModelFamily ?? null,
            },
            insight: {
                name: modelOptions.insightModel ?? null,
                family: modelOptions.insightModelFamily ?? null,
            },
        },
        temperature: modelOptions.temperature ?? null,
        keyShape,
        keyUpdatedAt: source.team.openRouterKeyUpdatedAt?.toISOString() ?? null,
        remediation: buildRemediation(keyShape.reason),
        verbose: args.verbose,
    };

    console.log(JSON.stringify(output, null, 2));
    return keyShape.status === 'valid' ? 0 : 1;
}

if (import.meta.main) {
    void runAiConfigDoctor()
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(message);
            process.exitCode = 1;
        });
}

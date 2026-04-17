import { prisma } from '@/lib/core/prisma';
import { decrypt } from '@/lib/security/crypto';
import { validateAiApiKey, type AiApiKeyInvalidReason } from '@/lib/validation/ai-api-key';

const AUDIT_ENV_FLAG = 'SKYTEST_ALLOW_KEY_AUDIT';

interface TeamWithEncryptedAiKey {
    id: string;
    openRouterKeyEncrypted: string | null;
    openRouterKeyUpdatedAt: Date | null;
}

export type AuditOutputFormat = 'json' | 'summary';

export interface TeamAiKeyAuditRecord {
    teamId: string;
    keyLength: number;
    invalidReason: AiApiKeyInvalidReason | null;
    keyUpdatedAt: string | null;
}

interface TeamAiKeyAuditSummary {
    totalTeams: number;
    validTeams: number;
    invalidTeams: number;
    invalidByReason: Record<AiApiKeyInvalidReason, number>;
}

function parseFormatArg(args: string[]): AuditOutputFormat {
    const formatArg = args.find((arg) => arg.startsWith('--format='));
    if (!formatArg) {
        return 'json';
    }

    const rawFormat = formatArg.slice('--format='.length).trim();
    if (rawFormat === 'json' || rawFormat === 'summary') {
        return rawFormat;
    }

    throw new Error(`Unsupported format "${rawFormat}". Use --format=json or --format=summary.`);
}

function assertAuditEnabled(env: NodeJS.ProcessEnv): void {
    if (env[AUDIT_ENV_FLAG] !== '1') {
        throw new Error(`${AUDIT_ENV_FLAG}=1 is required to run this audit.`);
    }
}

export function buildAuditRecord(team: TeamWithEncryptedAiKey): TeamAiKeyAuditRecord | null {
    if (!team.openRouterKeyEncrypted) {
        return null;
    }

    const decryptedKey = decrypt(team.openRouterKeyEncrypted);
    const validation = validateAiApiKey(decryptedKey);

    return {
        teamId: team.id,
        keyLength: decryptedKey.length,
        invalidReason: validation.ok ? null : validation.reason,
        keyUpdatedAt: team.openRouterKeyUpdatedAt ? team.openRouterKeyUpdatedAt.toISOString() : null,
    };
}

export function summarizeAuditRecords(records: TeamAiKeyAuditRecord[]): TeamAiKeyAuditSummary {
    const invalidByReason: Record<AiApiKeyInvalidReason, number> = {
        empty: 0,
        too_short: 0,
        non_ascii: 0,
    };

    for (const record of records) {
        if (record.invalidReason) {
            invalidByReason[record.invalidReason] += 1;
        }
    }

    const invalidTeams = Object.values(invalidByReason).reduce((sum, count) => sum + count, 0);
    return {
        totalTeams: records.length,
        validTeams: records.length - invalidTeams,
        invalidTeams,
        invalidByReason,
    };
}

export async function runAuditTeamAiKeys(args: string[] = process.argv.slice(2)): Promise<number> {
    assertAuditEnabled(process.env);
    const format = parseFormatArg(args);

    const teams = await prisma.team.findMany({
        where: {
            openRouterKeyEncrypted: {
                not: null,
            },
        },
        select: {
            id: true,
            openRouterKeyEncrypted: true,
            openRouterKeyUpdatedAt: true,
        },
    });

    const records = teams
        .map((team) => buildAuditRecord(team as TeamWithEncryptedAiKey))
        .filter((record): record is TeamAiKeyAuditRecord => record !== null);

    if (format === 'summary') {
        console.log(JSON.stringify(summarizeAuditRecords(records)));
    } else {
        for (const record of records) {
            console.log(JSON.stringify(record));
        }
    }

    return records.some((record) => record.invalidReason !== null) ? 1 : 0;
}

if (import.meta.main) {
    void runAuditTeamAiKeys()
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(message);
            process.exitCode = 1;
        });
}

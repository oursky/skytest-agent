import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    decrypt: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        team: {
            findMany: mocks.findMany,
        },
    },
}));

vi.mock('@/lib/security/crypto', () => ({
    decrypt: mocks.decrypt,
}));

const { runAuditTeamAiKeys } = await import('../audit-team-ai-keys');

describe('audit-team-ai-keys', () => {
    const originalEnv = process.env.SKYTEST_ALLOW_KEY_AUDIT;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        process.env.SKYTEST_ALLOW_KEY_AUDIT = '1';
        mocks.findMany.mockReset();
        mocks.decrypt.mockReset();
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.SKYTEST_ALLOW_KEY_AUDIT;
        } else {
            process.env.SKYTEST_ALLOW_KEY_AUDIT = originalEnv;
        }
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('prints one json line per team and returns exit code 1 when invalid keys exist', async () => {
        const validKey = 'sk-valid12345'; // gitleaks:allow
        const invalidKey = 'sk-bad✅12345';
        mocks.findMany.mockResolvedValue([
            {
                id: 'team-valid',
                openRouterKeyEncrypted: 'enc:valid',
                openRouterKeyUpdatedAt: new Date('2026-04-17T01:00:00.000Z'),
            },
            {
                id: 'team-invalid',
                openRouterKeyEncrypted: 'enc:invalid',
                openRouterKeyUpdatedAt: new Date('2026-04-17T02:00:00.000Z'),
            },
        ]);
        mocks.decrypt.mockImplementation((value: string) => (value === 'enc:valid' ? validKey : invalidKey));

        const exitCode = await runAuditTeamAiKeys(['--format=json']);

        expect(exitCode).toBe(1);
        const logCalls = logSpy.mock.calls as unknown[][];
        const records = logCalls.map((call) => JSON.parse(String(call[0]))) as Array<{
            teamId: string;
            keyLength: number | null;
            invalidReason: string | null;
            keyUpdatedAt: string | null;
        }>;

        expect(records).toEqual([
            {
                teamId: 'team-valid',
                keyLength: null,
                invalidReason: null,
                keyUpdatedAt: '2026-04-17T01:00:00.000Z',
            },
            {
                teamId: 'team-invalid',
                keyLength: invalidKey.length,
                invalidReason: 'non_ascii',
                keyUpdatedAt: '2026-04-17T02:00:00.000Z',
            },
        ]);

        const combinedOutput = logCalls
            .map((call) => String(call[0]))
            .join('\n');
        expect(combinedOutput).not.toContain(validKey);
        expect(combinedOutput).not.toContain(invalidKey);
    });

    it('prints summary counts and returns exit code 0 when all keys are valid', async () => {
        mocks.findMany.mockResolvedValue([
            {
                id: 'team-valid',
                openRouterKeyEncrypted: 'enc:valid',
                openRouterKeyUpdatedAt: new Date('2026-04-17T01:00:00.000Z'),
            },
        ]);
        mocks.decrypt.mockReturnValue('sk-valid12345');

        const exitCode = await runAuditTeamAiKeys(['--format=summary']);

        expect(exitCode).toBe(0);
        expect(logSpy).toHaveBeenCalledTimes(1);
        const summary = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
            totalTeams: number;
            validTeams: number;
            invalidTeams: number;
            invalidByReason: Record<string, number>;
        };

        expect(summary).toEqual({
            totalTeams: 1,
            validTeams: 1,
            invalidTeams: 0,
            invalidByReason: {
                empty: 0,
                too_short: 0,
                non_ascii: 0,
            },
        });
    });

    it('refuses to run without the audit env gate', async () => {
        delete process.env.SKYTEST_ALLOW_KEY_AUDIT;

        await expect(runAuditTeamAiKeys(['--format=summary'])).rejects.toThrow(
            'SKYTEST_ALLOW_KEY_AUDIT=1 is required to run this audit.'
        );
    });
});

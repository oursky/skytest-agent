import { describe, expect, it, vi } from 'vitest';
import { buildMidsceneModelConfig } from '@/lib/runtime/midscene-env';
import { InvalidAiApiKeyError } from '@/lib/core/errors';
import { validateAiApiKey, type AiApiKeyInvalidReason } from '@/lib/validation/ai-api-key';

const mocks = vi.hoisted(() => ({
    guardTeamRouteRequest: vi.fn(),
    validateRuntimeRequestUrl: vi.fn(),
    prisma: {
        team: {
            update: vi.fn(),
        },
    },
    encrypt: vi.fn(),
    maskApiKey: vi.fn(),
}));

vi.mock('@/lib/security/team-route-access', () => ({
    guardTeamRouteRequest: mocks.guardTeamRouteRequest,
}));

vi.mock('@/lib/security/url-security-runtime', () => ({
    validateRuntimeRequestUrl: mocks.validateRuntimeRequestUrl,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: mocks.prisma,
}));

vi.mock('@/lib/security/crypto', () => ({
    decrypt: vi.fn(),
    encrypt: mocks.encrypt,
    maskApiKey: mocks.maskApiKey,
}));

const { POST } = await import('@/app/api/teams/[id]/ai-key/route');

interface BoundaryCase {
    input: string;
    expectedReason: AiApiKeyInvalidReason | null;
}

const BOUNDARY_CASES: BoundaryCase[] = [
    { input: '', expectedReason: 'empty' },
    { input: ' ', expectedReason: 'empty' },
    { input: 'short', expectedReason: 'too_short' },
    { input: 'good-key-with-✅', expectedReason: 'non_ascii' },
    { input: 'has\nnewline', expectedReason: 'non_ascii' },
    { input: 'sk-abc12345', expectedReason: null },
];

describe('ai-api-key boundaries', () => {
    it.each(BOUNDARY_CASES)('keeps validator, API route, and runtime aligned for "$input"', async ({ input, expectedReason }) => {
        mocks.guardTeamRouteRequest.mockResolvedValue({
            ok: true,
            teamId: 'team-1',
            userId: 'user-1',
            params: { id: 'team-1' },
        });
        mocks.validateRuntimeRequestUrl.mockResolvedValue({ valid: true });
        mocks.prisma.team.update.mockResolvedValue({ id: 'team-1' });
        mocks.encrypt.mockImplementation((value: string) => `enc:${value}`);
        mocks.maskApiKey.mockImplementation((value: string) => `masked:${value.slice(0, 4)}`);

        const validation = validateAiApiKey(input);
        if (expectedReason === null) {
            expect(validation).toEqual({ ok: true });
        } else {
            expect(validation.ok).toBe(false);
            if (!validation.ok) {
                expect(validation.reason).toBe(expectedReason);
            }
        }

        const response = await POST(new Request('http://localhost/api/teams/team-1/ai-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: input }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        if (expectedReason === null) {
            expect(response.status).toBe(200);
            expect(payload.success).toBe(true);
        } else {
            expect(response.status).toBe(400);
            if (validation.ok) {
                throw new Error('Expected validator to reject input');
            }
            expect(payload).toMatchObject({
                code: 'VALIDATION_ERROR',
                details: {
                    fieldErrors: {
                        apiKey: validation.message,
                    },
                },
            });
        }

        if (expectedReason === null) {
            expect(() => buildMidsceneModelConfig(input)).not.toThrow();
        } else {
            expect(() => buildMidsceneModelConfig(input)).toThrowError(InvalidAiApiKeyError);
            try {
                buildMidsceneModelConfig(input);
            } catch (error) {
                expect(error).toBeInstanceOf(InvalidAiApiKeyError);
                if (error instanceof InvalidAiApiKeyError) {
                    expect(error.reason).toBe(expectedReason);
                }
            }
        }
    });
});

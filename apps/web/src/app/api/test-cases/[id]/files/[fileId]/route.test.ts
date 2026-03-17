import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    verifyStreamToken: vi.fn(),
    isProjectMember: vi.fn(),
    testCaseFindUnique: vi.fn(),
    testCaseFileFindFirst: vi.fn(),
    testCaseFileFindUnique: vi.fn(),
    readObjectBuffer: vi.fn(),
    deleteObjectIfExists: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/stream-token', () => ({
    verifyStreamToken: mocks.verifyStreamToken,
}));

vi.mock('@/lib/security/permissions', () => ({
    isProjectMember: mocks.isProjectMember,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testCase: {
            findUnique: mocks.testCaseFindUnique,
        },
        testCaseFile: {
            findFirst: mocks.testCaseFileFindFirst,
            findUnique: mocks.testCaseFileFindUnique,
        },
    },
}));

vi.mock('@/lib/storage/object-store-utils', () => ({
    readObjectBuffer: mocks.readObjectBuffer,
    deleteObjectIfExists: mocks.deleteObjectIfExists,
}));

const { GET } = await import('@/app/api/test-cases/[id]/files/[fileId]/route');

describe('GET /api/test-cases/[id]/files/[fileId]', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.verifyStreamToken.mockReset();
        mocks.isProjectMember.mockReset();
        mocks.testCaseFindUnique.mockReset();
        mocks.testCaseFileFindFirst.mockReset();
        mocks.testCaseFileFindUnique.mockReset();
        mocks.readObjectBuffer.mockReset();
        mocks.deleteObjectIfExists.mockReset();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');
    });

    it('returns 404 when storedName is not a test-case file for the requested case', async () => {
        mocks.testCaseFindUnique.mockResolvedValue({ id: 'tc-1', projectId: 'project-1' });
        mocks.isProjectMember.mockResolvedValue(true);
        mocks.testCaseFileFindFirst.mockResolvedValue(null);

        const response = await GET(
            new Request('http://localhost/api/test-cases/tc-1/files/file-1?storedName=arbitrary/object-key'),
            { params: Promise.resolve({ id: 'tc-1', fileId: 'file-1' }) }
        );

        expect(response.status).toBe(404);
        expect(mocks.readObjectBuffer).not.toHaveBeenCalled();
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    findUniqueRun,
    updateManyRun,
    createManyEvents,
    updateRun,
    updateTestCase,
    createRunFile,
    transaction,
    putObjectBuffer,
} = vi.hoisted(() => ({
    findUniqueRun: vi.fn(),
    updateManyRun: vi.fn(),
    createManyEvents: vi.fn(),
    updateRun: vi.fn(),
    updateTestCase: vi.fn(),
    createRunFile: vi.fn(),
    transaction: vi.fn(),
    putObjectBuffer: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        $transaction: transaction,
        testRun: {
            findUnique: findUniqueRun,
            update: updateRun,
        },
        testRunFile: {
            create: createRunFile,
        },
    },
}));

vi.mock('@/lib/storage/object-store-utils', () => ({
    putObjectBuffer,
}));

const { appendRunEvents, completeOwnedRun } = await import('@/lib/runners/event-service');

describe('event-service', () => {
    beforeEach(() => {
        findUniqueRun.mockReset();
        updateManyRun.mockReset();
        createManyEvents.mockReset();
        updateRun.mockReset();
        updateTestCase.mockReset();
        createRunFile.mockReset();
        transaction.mockReset();
        putObjectBuffer.mockReset();

        transaction.mockImplementation(async (callback: (tx: {
            testRun: {
                findUnique: typeof findUniqueRun;
                updateMany: typeof updateManyRun;
                update: typeof updateRun;
            };
            testRunEvent: {
                createMany: typeof createManyEvents;
            };
            testCase: {
                update: typeof updateTestCase;
            };
        }) => Promise<unknown>) => callback({
            testRun: {
                findUnique: findUniqueRun,
                updateMany: updateManyRun,
                update: updateRun,
            },
            testRunEvent: {
                createMany: createManyEvents,
            },
            testCase: {
                update: updateTestCase,
            },
        }));
        updateManyRun.mockResolvedValue({ count: 1 });
    });

    it('appends events with reserved sequence numbers', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 4,
        });

        const result = await appendRunEvents({
            runId: 'run-1',
            runnerId: 'runner-1',
            events: [
                { kind: 'STEP', message: 'one' },
                { kind: 'STEP', message: 'two' },
            ],
        });

        expect(updateManyRun).toHaveBeenCalledWith({
            where: {
                id: 'run-1',
                assignedRunnerId: 'runner-1',
                nextEventSequence: 4,
            },
            data: {
                nextEventSequence: 6,
                lastEventAt: expect.any(Date),
                leaseExpiresAt: expect.any(Date),
            },
        });
        expect(createManyEvents).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ runId: 'run-1', sequence: 4, kind: 'STEP' }),
                expect.objectContaining({ runId: 'run-1', sequence: 5, kind: 'STEP' }),
            ],
        });
        expect(result).toEqual({ accepted: 2, nextSequence: 6 });
    });

    it('promotes PREPARING runs to RUNNING when events arrive', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'PREPARING',
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 1,
        });

        await appendRunEvents({
            runId: 'run-1',
            runnerId: 'runner-1',
            events: [{ kind: 'LOG', message: 'running' }],
        });

        expect(updateManyRun).toHaveBeenCalledWith({
            where: {
                id: 'run-1',
                assignedRunnerId: 'runner-1',
                nextEventSequence: 1,
            },
            data: {
                status: 'RUNNING',
                nextEventSequence: 2,
                lastEventAt: expect.any(Date),
                leaseExpiresAt: expect.any(Date),
            },
        });
    });

    it('rejects appending when run ownership is invalid', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            assignedRunnerId: 'runner-2',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 1,
        });

        const result = await appendRunEvents({
            runId: 'run-1',
            runnerId: 'runner-1',
            events: [{ kind: 'STEP' }],
        });

        expect(result).toBeNull();
        expect(updateManyRun).not.toHaveBeenCalled();
        expect(createManyEvents).not.toHaveBeenCalled();
    });

    it('marks owned runs completed', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 1,
        });

        const result = await completeOwnedRun({
            runId: 'run-1',
            runnerId: 'runner-1',
            result: '{"ok":true}',
        });

        expect(updateRun).toHaveBeenCalledWith({
            where: { id: 'run-1' },
            data: {
                status: 'PASS',
                result: '{"ok":true}',
                completedAt: expect.any(Date),
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });
        expect(updateTestCase).toHaveBeenCalledWith({
            where: { id: 'tc-1' },
            data: { status: 'PASS' },
        });
        expect(result).toEqual({ runId: 'run-1', status: 'PASS' });
    });
});
